#!/usr/bin/env python3
import os, sys, re, json, time
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
            time.sleep(1.2)
            continue
        break
    raise RuntimeError(f"Failed to fetch URL (last status {last_status}): {url}")

# ---------------- Playwright helpers ----------------

def playwright_dom(url: str, ua: str, wait_selector: Optional[str] = None, timeout_ms: int = 90000, tries: int = 2) -> Tuple[str, str]:
    """
    Load a page and return rendered HTML, final URL. Retries with longer waits and selector-based gating.
    """
    from playwright.sync_api import sync_playwright
    last_exc = None
    for attempt in range(tries):
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                context = browser.new_context(user_agent=ua)
                # block heavy trackers to speed up
                context.route("**/*", lambda route: route.continue_())
                page = context.new_page()
                page.goto(url, timeout=timeout_ms, wait_until="domcontentloaded")
                # Wait for something meaningful to appear
                target = wait_selector or "script#__NEXT_DATA__, a[href*='/p/']"
                try:
                    page.wait_for_selector(target, timeout=15000)
                except Exception:
                    pass
                # small idle to allow hydration
                page.wait_for_timeout(1500)
                html = page.content()
                final = page.url
                browser.close()
                return html, final
        except Exception as e:
            last_exc = e
            time.sleep(2)
    raise RuntimeError(f"Playwright DOM fetch failed after {tries} tries: {last_exc}")

def playwright_collect_archive(api_base_url: str, archive_url: str, ua: str, timeout_ms: int = 120000) -> Tuple[List[Dict[str, Any]], str]:
    """
    Navigate to /archive, capture JSON API responses while scrolling to trigger loads.
    Returns (items, final_url).
    """
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
                        slug = p.get("slug"); 
                        if not url and slug: url = "/p/" + slug
                        link = urljoin(base_url, url or ""); 
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
        captured: List[str] = []

        def on_response(resp):
            try:
                ctype = (resp.headers or {}).get("content-type", "")
                u = resp.url
                if "application/json" in ctype and "/api" in u:
                    try:
                        captured.append(resp.text())
                    except Exception:
                        pass
            except Exception:
                pass

        page.on("response", on_response)
        page.goto(archive_url, timeout=timeout_ms, wait_until="domcontentloaded")
        # Wait for initial content (archive list or hydration script)
        try:
            page.wait_for_selector("script#__NEXT_DATA__, a[href*='/p/']", timeout=20000)
        except Exception:
            pass

        # Scroll to trigger more loads (3 passes)
        for _ in range(3):
            page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            page.wait_for_timeout(2000)

        html = page.content()
        final = page.url
        browser.close()

    api_items: List[Dict[str, Any]] = []
    for text in captured:
        try:
            data = json.loads(text)
            api_items.extend(normalize_posts(data, api_base_url))
        except Exception:
            continue

    # If API gave nothing, try __NEXT_DATA__ from HTML
    if not api_items:
        soup = BeautifulSoup(html, "lxml")
        script = soup.find("script", id="__NEXT_DATA__", type="application/json")
        if script and (script.string or script.text):
            try:
                data = json.loads(script.string or script.text)
                api_items.extend(normalize_posts(data, api_base_url))
            except Exception:
                pass

    # Dedupe
    seen, merged = set(), []
    for it in api_items:
        href = it.get("link")
        if href and href not in seen:
            seen.add(href); merged.append(it)

    return merged, final

# ---------------- Parsers & rendering ----------------

def parse_feed_bytes(xml_bytes: bytes) -> Any:
    data = feedparser.parse(xml_bytes)
    if data.bozo and not data.entries:
        raise RuntimeError(f"Feed parse error: {data.bozo_exception}")
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

def parse_substack_html(content: bytes, page_url: str) -> Tuple[str, List[Dict[str, Any]]]:
    soup = BeautifulSoup(content, "lxml")
    site_title = soup.title.get_text(strip=True) if soup.title else "My Substack Feed"
    items: List[Dict[str, Any]] = []
    # JSON-LD
    for tag in soup.find_all("script", attrs={"type":"application/ld+json"}):
        try:
            data = json.loads(tag.string or tag.text or "")
        except Exception:
            continue
        stack = [data]
        while stack:
            node = stack.pop()
            if isinstance(node, dict):
                if node.get("@type") == "ItemList":
                    for el in node.get("itemListElement", []):
                        payload = el.get("item") if isinstance(el, dict) else None
                        if isinstance(payload, dict):
                            items.append({
                                "title": payload.get("name") or payload.get("headline") or "Untitled",
                                "link": urljoin(page_url, payload.get("url") or ""),
                                "datePublished": payload.get("datePublished") or payload.get("dateCreated") or "",
                                "summary": payload.get("description") or "",
                            })
                if node.get("@type") in ("BlogPosting","Article","NewsArticle"):
                    items.append({
                        "title": node.get("headline") or node.get("name") or "Untitled",
                        "link": urljoin(page_url, node.get("url") or ""),
                        "datePublished": node.get("datePublished") or "",
                        "summary": node.get("description") or "",
                    })
                for v in node.values(): stack.append(v)
            elif isinstance(node, list):
                stack.extend(node)
    # Anchor heuristics as fallback
    if not items:
        for sel in ["a.post-preview-title","h2 a[href*='/p/']","h3 a[href*='/p/']","article a[href*='/p/']","a[href*='/p/']"]:
            for a in soup.select(sel):
                href = a.get("href") or ""
                if not href: continue
                full = urljoin(page_url, href)
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
    # Dedup
    seen, uniq = set(), []
    for it in items:
        href = it.get("link") or ""
        if href and href not in seen: seen.add(href); uniq.append(it)
    return site_title, uniq

def render_index(feed_title: str, feed_url: str, pub_url: str, items: List[Dict[str, Any]]):
    env = Environment(loader=FileSystemLoader("."), autoescape=select_autoescape(["html","xml"]))
    tpl = env.get_template(TEMPLATE_FILE.name)
    html = tpl.render(site_title=feed_title or "My Substack Feed",
                      public_url=pub_url, feed_url=feed_url,
                      generated_at=datetime.now(timezone.utc), items=items)
    (DIST_DIR / "index.html").write_text(html, encoding="utf-8")

# ---------------- Main ----------------

def main():
    ensure_dist()
    feed_url = os.getenv("SUBSTACK_FEED", "https://substack.com/@damii3")  # handle allowed
    public_url = os.getenv("PUBLIC_SUBSTACK_URL", feed_url)
    ua = os.getenv("FETCH_UA", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
    item_limit = int(os.getenv("ITEM_LIMIT","25"))

    print(f"Fetching feed: {feed_url}")
    # Try RSS first
    try:
        content, ctype, final_url = http_get(feed_url, ua, public_url)
        if not is_html_payload(content, ctype):
            cleaned = XML_INVALID_CTRL_RE.sub(b"", content)
            parsed = parse_feed_bytes(cleaned)
            title = (getattr(parsed,"feed",{}) or {}).get("title") or "My Substack Feed"
            items = normalize_entries(parsed.entries, limit=item_limit)
            print(f"Parsed {len(items)} items (RSS)")
            render_index(title, feed_url, public_url, items); print("Wrote dist/index.html"); return
    except Exception as e:
        print(f"HTTP fetch failed ({e}); trying rendered DOM…")

    # Must have Playwright for Substack walls
    if os.getenv("USE_PLAYWRIGHT","0") != "1":
        raise RuntimeError("RSS blocked and USE_PLAYWRIGHT!=1; enable Playwright to proceed.")

    # Rendered /feed (might embed data)
    html, final_url = playwright_dom(feed_url, ua)

    # Prefer /archive with API capture + scroll
    origin = base_origin(final_url or feed_url)
    archive_url = urljoin(origin + "/", "archive")
    try:
        api_items, arch_final = playwright_collect_archive(origin, archive_url, ua)
    except Exception as e:
        print(f"Rendered /archive API capture failed: {e}", file=sys.stderr)
        api_items = []

    items: List[Dict[str, Any]] = []
    site_title = "My Substack Feed"

    if api_items:
        items = normalize_entries(api_items, limit=item_limit)
        site_title = origin
    else:
        # Fallback: parse rendered /archive DOM (no networkidle)
        try:
            arch_html, arch_final = playwright_dom(archive_url, ua, wait_selector="a[href*='/p/']")
            site_title, html_items = parse_substack_html(arch_html.encode("utf-8"), arch_final)
            items = normalize_entries(html_items, limit=item_limit)
        except Exception as e:
            print(f"Rendered /archive DOM parse failed: {e}", file=sys.stderr)
            # Try currently rendered page DOM
            site_title, html_items = parse_substack_html(html.encode("utf-8"), final_url)
            items = normalize_entries(html_items, limit=item_limit)

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
