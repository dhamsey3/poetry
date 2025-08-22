#!/usr/bin/env python3
import os, sys, re, json
from urllib.parse import urlparse, urljoin
from pathlib import Path
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional, Tuple

import requests
import feedparser
from bs4 import BeautifulSoup
from dateutil import parser as dparser
from jinja2 import Environment, FileSystemLoader, select_autoescape

DIST_DIR = Path("dist")
TEMPLATE_FILE = Path("index.html.j2")
SOFT_FAIL = os.getenv("SOFT_FAIL", "0") == "1"
XML_INVALID_CTRL_RE = re.compile(rb"[\x00-\x08\x0B\x0C\x0E-\x1F]")

def ensure_dist():
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    (DIST_DIR / ".nojekyll").write_text("", encoding="utf-8")

def is_html_payload(content: bytes, content_type: str) -> bool:
    if content_type and "html" in content_type.lower():
        return True
    head = content[:200].lstrip().lower()
    return head.startswith(b"<!doctype html") or head.startswith(b"<html")

def base_origin(u: str) -> str:
    p = urlparse(u); return f"{p.scheme}://{p.netloc}"

def http_get(url: str, ua: str, referer: str) -> Tuple[bytes, str, str]:
    headers = {
        "User-Agent": ua or "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Accept": "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": referer or "https://www.google.com/",
        "DNT": "1", "Cache-Control": "no-cache", "Pragma": "no-cache", "Connection": "keep-alive",
    }
    s = requests.Session()
    last_status = None
    for _ in range(3):
        r = s.get(url, headers=headers, timeout=30, allow_redirects=True)
        last_status = r.status_code
        if r.status_code == 200:
            return r.content, r.headers.get("content-type",""), r.url
        if r.status_code in (403, 429):
            import time, random; time.sleep(1.2 + random.random()); continue
        break
    raise RuntimeError(f"Failed to fetch URL (last status {last_status}): {url}")

# ---------- Playwright helpers ----------

def playwright_dom(url: str, ua: str, wait_selector: Optional[str] = None, timeout_ms: int = 45000) -> Tuple[str, str]:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(user_agent=ua)
        page = context.new_page()
        page.goto(url, timeout=timeout_ms, wait_until="load")
        if wait_selector:
            try: page.wait_for_selector(wait_selector, timeout=8000)
            except Exception: pass
        else:
            try: page.wait_for_selector("a[href]", timeout=6000)
            except Exception: pass
        html = page.content(); final = page.url
        browser.close()
    return html, final

def playwright_collect_archive(api_base_url: str, archive_url: str, ua: str) -> Tuple[List[Dict[str, Any]], str]:
    from playwright.sync_api import sync_playwright
    items: List[Dict[str, Any]] = []
    def normalize_posts(obj: Any, base_url: str) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        def walk(node):
            if isinstance(node, dict):
                if "posts" in node and isinstance(node["posts"], list):
                    for p in node["posts"]:
                        if not isinstance(p, dict): continue
                        title = p.get("title") or p.get("headline") or p.get("name") or p.get("subject") or "Untitled"
                        url  = p.get("canonical_url") or p.get("url")
                        slug = p.get("slug")
                        if not url and slug: url = "/p/" + slug
                        link = urljoin(base_url, url or "")
                        if not link: continue
                        date = p.get("date_published") or p.get("published_at") or p.get("datePublished") or p.get("post_date") or ""
                        summary = p.get("description") or p.get("subtitle") or p.get("excerpt") or ""
                        out.append({"title": title, "link": link, "datePublished": date, "summary": summary})
                for v in node.values(): walk(v)
            elif isinstance(node, list):
                for v in node: walk(v)
        walk(obj)
        seen, uniq = set(), []
        for it in out:
            href = it.get("link") or ""
            if href and href not in seen: seen.add(href); uniq.append(it)
        return uniq
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(user_agent=ua)
        page = context.new_page()
        captured: List[Tuple[str, str]] = []
        def on_response(resp):
            try:
                url = resp.url
                ctype = (resp.headers or {}).get("content-type", "")
                if "application/json" in ctype and "/api" in url:
                    try: captured.append((url, resp.text()))
                    except Exception: pass
            except Exception: pass
        page.on("response", on_response)
        page.goto(archive_url, timeout=50000, wait_until="networkidle")
        next_items: List[Dict[str, Any]] = []
        try:
            script = page.locator("script#__NEXT_DATA__").first
            if script and script.count() > 0:
                payload = script.text_content() or ""
                data = json.loads(payload); next_items = normalize_posts(data, api_base_url)
        except Exception: pass
        api_items: List[Dict[str, Any]] = []
        for _, text in captured:
            try: api_items.extend(normalize_posts(json.loads(text), api_base_url))
            except Exception: continue
        final = page.url
        browser.close()
    merged, seen = [], set()
    for it in api_items + next_items:
        href = it.get("link"); if href and href not in seen: seen.add(href); merged.append(it)
    return merged, final

# ---------- Parsers ----------

def parse_feed_bytes(xml_bytes: bytes) -> Any:
    data = feedparser.parse(xml_bytes)
    if data.bozo and not data.entries: raise RuntimeError(f"Feed parse error: {data.bozo_exception}")
    return data

def to_iso(dt) -> str:
    if hasattr(dt, "tzinfo"):
        if dt.tzinfo is None: dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    return str(dt)

def normalize_entries(entries: List[Dict[str, Any]], limit: int = 25) -> List[Dict[str, Any]]:
    norm: List[Dict[str, Any]] = []
    for e in entries:
        title = e.get("title", "Untitled"); link = e.get("link")
        dt = None
        for key in ("published","updated","created","datePublished"):
            val = e.get(key)
            if val:
                try: dt = dparser.parse(val); break
                except Exception: pass
        summary = e.get("summary", e.get("description",""))
        if not summary and e.get("content"):
            try: summary = e["content"][0].get("value","")
            except Exception: pass
        norm.append({"title": title, "link": link, "date": dt, "date_iso": to_iso(dt) if dt else "", "summary": summary})
    norm.sort(key=lambda x: x["date"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    return norm[:limit]

def parse_jsonld_posts(soup: BeautifulSoup, base_url: str) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for tag in soup.find_all("script", attrs={"type":"application/ld+json"}):
        try: data = json.loads(tag.string or tag.text or ""); 
        except Exception: continue
        stack = [data]; 
        while stack:
            node = stack.pop()
            if isinstance(node, dict):
                if node.get("@type") in ("ItemList","Blog","WebSite","BlogPosting","Article","NewsArticle"):
                    if node.get("@type")=="ItemList":
                        for el in node.get("itemListElement", []):
                            payload = el.get("item") if isinstance(el, dict) else None
                            if isinstance(payload, dict):
                                items.append({"title": payload.get("name") or payload.get("headline") or "Untitled",
                                              "link": urljoin(base_url, payload.get("url") or ""),
                                              "datePublished": payload.get("datePublished") or payload.get("dateCreated") or "",
                                              "summary": payload.get("description") or ""})
                    if node.get("@type") in ("BlogPosting","Article","NewsArticle"):
                        items.append({"title": node.get("headline") or node.get("name") or "Untitled",
                                      "link": urljoin(base_url, node.get("url") or ""),
                                      "datePublished": node.get("datePublished") or "",
                                      "summary": node.get("description") or ""})
                for v in node.values(): stack.append(v)
            elif isinstance(node, list): stack.extend(node)
    seen, uniq = set(), []
    for it in items:
        href = it.get("link") or ""
        if href and href not in seen: seen.add(href); uniq.append(it)
    return uniq

def parse_archive_links(soup: BeautifulSoup, base_url: str) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for sel in ["a.post-preview-title","h2 a[href*='/p/']","h3 a[href*='/p/']","article a[href*='/p/']","a[href*='/p/']"]:
        for a in soup.select(sel):
            href = a.get("href") or ""; 
            if not href: continue
            full = urljoin(base_url, href)
            if base_origin(full) != base_origin(base_url): continue
            title = a.get_text(strip=True) or a.get("title") or "Untitled"
            dt = ""
            t = a.find("time")
            if not t:
                par=a.parent
                for _ in range(3):
                    if not par: break
                    t = par.find("time")
                    if t: break
                    par = par.parent
            if t and (t.get("datetime") or t.text): dt = t.get("datetime") or t.get_text(strip=True)
            items.append({"title": title, "link": full, "datePublished": dt, "summary": ""})
    seen, uniq = set(), []
    for it in items:
        href=it["link"]
        if href not in seen: seen.add(href); uniq.append(it)
    return uniq

def parse_substack_html(content: bytes, page_url: str) -> Tuple[str, List[Dict[str, Any]]]:
    soup = BeautifulSoup(content, "lxml")
    site_title = soup.title.get_text(strip=True) if soup.title else "My Substack Feed"
    items = parse_jsonld_posts(soup, page_url)
    if not items: items = parse_archive_links(soup, page_url)
    return site_title, items

# ---------- NEW: resolve profile handle → publication base ----------

def resolve_publication_base(url: str, ua: str) -> Optional[str]:
    """
    If URL is like https://substack.com/@handle, open it (rendered)
    and find a link to https://<pub>.substack.com . Return that base.
    """
    if "substack.com/@".lower() not in url.lower():
        return None
    if os.getenv("USE_PLAYWRIGHT","0") != "1":
        return None
    try:
        html, final = playwright_dom(url, ua)
        soup = BeautifulSoup(html, "lxml")
        # 1) explicit anchors to *.substack.com
        for a in soup.select("a[href^='https://'][href*='.substack.com']"):
            href = a.get("href"); 
            if not href: continue
            p = urlparse(href)
            if p.scheme.startswith("http") and p.netloc.endswith(".substack.com"):
                return f"{p.scheme}://{p.netloc}"
        # 2) try JSON in __NEXT_DATA__ for publication canonical url
        script = soup.find("script", id="__NEXT_DATA__", type="application/json")
        if script and (script.string or script.text):
            try:
                data = json.loads(script.string or script.text)
                # look for canonical_url anywhere
                def find_pub(n):
                    if isinstance(n, dict):
                        if "canonical_url" in n and ".substack.com" in str(n["canonical_url"]):
                            u = n["canonical_url"]; p=urlparse(u)
                            return f"{p.scheme}://{p.netloc}"
                        for v in n.values():
                            r = find_pub(v)
                            if r: return r
                    elif isinstance(n, list):
                        for v in n:
                            r = find_pub(v)
                            if r: return r
                    return None
                found = find_pub(data)
                if found: return found
            except Exception:
                pass
    except Exception:
        pass
    return None

# ---------- Rendering ----------

def render_index(feed_title: str, feed_url: str, pub_url: str, items: List[Dict[str, Any]]):
    env = Environment(loader=FileSystemLoader("."), autoescape=select_autoescape(["html","xml"]))
    tpl = env.get_template(TEMPLATE_FILE.name)
    html = tpl.render(site_title=feed_title or "My Substack Feed",
                      public_url=pub_url, feed_url=feed_url,
                      generated_at=datetime.now(timezone.utc), items=items)
    (DIST_DIR / "index.html").write_text(html, encoding="utf-8")

# ---------- Main ----------

def main():
    ensure_dist()
    feed_url = os.getenv("SUBSTACK_FEED", "https://substack.com/@damii3")  # allow profile handle
    public_url = os.getenv("PUBLIC_SUBSTACK_URL", feed_url)
    ua = os.getenv("FETCH_UA", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
    item_limit = int(os.getenv("ITEM_LIMIT","25"))

    # If it’s a handle URL, resolve to publication base first
    pub_base = None
    if "substack.com/@".lower() in feed_url.lower() and os.getenv("USE_PLAYWRIGHT","0") == "1":
        print("Resolving Substack handle to publication base…")
        pub_base = resolve_publication_base(feed_url, ua)
        if pub_base:
            print(f"Resolved publication: {pub_base}")
            # Try RSS on the publication directly
            try:
                content, ctype, final = http_get(urljoin(pub_base+"/","feed"), ua, public_url)
                if not is_html_payload(content, ctype):
                    cleaned = XML_INVALID_CTRL_RE.sub(b"", content)
                    parsed = parse_feed_bytes(cleaned)
                    title = (getattr(parsed,"feed",{}) or {}).get("title") or "My Substack Feed"
                    items = normalize_entries(parsed.entries, limit=item_limit)
                    print(f"Parsed {len(items)} items (pub RSS)")
                    render_index(title, feed_url, public_url, items); print("Wrote dist/index.html"); return
            except Exception as e:
                print(f"Pub RSS blocked: {e}")

    print(f"Fetching feed: {feed_url}")
    # Standard path
    try:
        content, ctype, final_url = http_get(feed_url, ua, public_url)
    except Exception as e:
        if os.getenv("USE_PLAYWRIGHT","0") == "1":
            print(f"HTTP fetch failed ({e}); trying rendered DOM…")
            html, final_url = playwright_dom(feed_url, ua)
            content, ctype = html.encode("utf-8"), "text/html"
        else:
            raise

    site_title = "My Substack Feed"
    items: List[Dict[str, Any]] = []

    # If HTML, prefer publication base if we found one
    if is_html_payload(content, ctype) and pub_base:
        origin = pub_base
    else:
        origin = base_origin(final_url if 'final_url' in locals() else feed_url)

    # Try publication /archive via Playwright API capture
    if os.getenv("USE_PLAYWRIGHT","0") == "1":
        arch = urljoin(origin + "/","archive")
        try:
            api_items, arch_final = playwright_collect_archive(origin, arch, ua)
            if api_items:
                items = normalize_entries(api_items, limit=item_limit)
                site_title = origin
        except Exception as e:
            print(f"Rendered /archive API capture failed: {e}", file=sys.stderr)

    # If still empty, parse rendered/current HTML
    if not items:
        if is_html_payload(content, ctype):
            print("No valid RSS; scraping HTML…")
            try:
                # prefer rendered /archive DOM
                arch = urljoin(origin + "/","archive")
                html, arch_final = playwright_dom(arch, ua)
                site_title2, html_items = parse_substack_html(html.encode("utf-8"), arch_final)
                items = normalize_entries(html_items, limit=item_limit)
                if site_title2: site_title = site_title2
            except Exception:
                site_title2, html_items = parse_substack_html(content, final_url if 'final_url' in locals() else feed_url)
                items = normalize_entries(html_items, limit=item_limit)
                if site_title2: site_title = site_title2
        else:
            cleaned = XML_INVALID_CTRL_RE.sub(b"", content)
            parsed = parse_feed_bytes(cleaned)
            site_title = (getattr(parsed,"feed",{}) or {}).get("title") or site_title
            items = normalize_entries(parsed.entries, limit=item_limit)

    print(f"Parsed {len(items)} items")
    if not items and not SOFT_FAIL:
        raise RuntimeError("No items found from RSS or HTML fallback.")
    render_index(site_title, feed_url, public_url, items)
    print("Wrote dist/index.html")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        if SOFT_FAIL:
            ensure_dist()
            (DIST_DIR / "index.html").write_text(
                f"""<html><body>
<h1>Feed temporarily unavailable</h1>
<p>{e}</p>
</body></html>""", encoding="utf-8")
            print("WARN: soft-failed and wrote placeholder page.")
        else:
            print(f"ERROR: {e}", file=sys.stderr)
            sys.exit(1)
