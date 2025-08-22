#!/usr/bin/env python3
import os
import sys
import re
import json
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
    p = urlparse(u)
    return f"{p.scheme}://{p.netloc}"

def discover_feed_from_html(html: str, base_url: str) -> Optional[str]:
    soup = BeautifulSoup(html, "html.parser")
    for link in soup.find_all("link"):
        rel = (link.get("rel") or [])
        rel = [r.lower() for r in rel] if isinstance(rel, list) else [str(rel).lower()]
        type_attr = (link.get("type") or "").lower()
        href = link.get("href")
        if not href:
            continue
        if ("alternate" in rel) and ("rss" in type_attr or "atom" in type_attr or "xml" in type_attr):
            return urljoin(base_url, href)
    return None

def http_get(url: str, ua: str, referer: str) -> Tuple[bytes, str, str]:
    headers = {
        "User-Agent": ua or "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Accept": "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": referer or "https://www.google.com/",
        "DNT": "1",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Connection": "keep-alive",
    }
    s = requests.Session()
    last_status = None
    for attempt in range(3):
        r = s.get(url, headers=headers, timeout=30, allow_redirects=True)
        last_status = r.status_code
        if r.status_code == 200:
            ctype = r.headers.get("content-type", "")
            return r.content, ctype, r.url
        if r.status_code in (403, 429):
            import time, random
            time.sleep(1.5 + random.random())
            continue
        break

    # network response failed; caller may still try DOM-rendered fetch
    raise RuntimeError(f"Failed to fetch URL (last status {last_status}): {url}")

def playwright_dom(url: str, ua: str, wait_selector: Optional[str] = None, timeout_ms: int = 45000) -> Tuple[str, str]:
    """Return (rendered_html, final_url) after allowing hydration."""
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(user_agent=ua)
        page = context.new_page()
        page.goto(url, timeout=timeout_ms, wait_until="load")
        # give it a moment for client-side rendering; wait for a typical selector if provided
        if wait_selector:
            try:
                page.wait_for_selector(wait_selector, timeout=8000)
            except Exception:
                pass
        else:
            try:
                page.wait_for_selector("a[href*='/p/']", timeout=6000)
            except Exception:
                pass
        html = page.content()
        final = page.url
        browser.close()
    return html, final

def parse_feed_bytes(xml_bytes: bytes) -> Any:
    data = feedparser.parse(xml_bytes)
    if data.bozo and not data.entries:
        raise RuntimeError(f"Feed parse error: {data.bozo_exception}")
    return data

def to_iso(dt) -> str:
    if hasattr(dt, "tzinfo"):
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    return str(dt)

def normalize_entries(entries: List[Dict[str, Any]], limit: int = 25) -> List[Dict[str, Any]]:
    norm: List[Dict[str, Any]] = []
    for e in entries:
        title = e.get("title", "Untitled")
        link = e.get("link")
        dt = None
        for key in ("published", "updated", "created", "datePublished"):
            val = e.get(key)
            if val:
                try:
                    dt = dparser.parse(val)
                    break
                except Exception:
                    pass
        summary = e.get("summary", e.get("description", ""))
        if not summary and e.get("content"):
            try:
                summary = e["content"][0].get("value", "")
            except Exception:
                pass
        norm.append({
            "title": title,
            "link": link,
            "date": dt,
            "date_iso": to_iso(dt) if dt else "",
            "summary": summary,
        })
    norm.sort(key=lambda x: x["date"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    return norm[:limit]

# --------- HTML fallbacks ----------

def parse_jsonld_posts(soup: BeautifulSoup, base_url: str) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for tag in soup.find_all("script", attrs={"type": "application/ld+json"}):
        try:
            data = json.loads(tag.string or tag.text or "")
        except Exception:
            continue
        candidates = []
        if isinstance(data, dict) and "@graph" in data and isinstance(data["@graph"], list):
            candidates.extend(data["@graph"])
        elif isinstance(data, dict):
            candidates.append(data)
        elif isinstance(data, list):
            candidates.extend(data)
        for obj in candidates:
            if not isinstance(obj, dict):
                continue
            typ = obj.get("@type")
            if typ == "ItemList":
                for el in obj.get("itemListElement", []):
                    payload = el.get("item") if isinstance(el, dict) else None
                    if isinstance(payload, dict):
                        items.append({
                            "title": payload.get("name") or payload.get("headline") or "Untitled",
                            "link": urljoin(base_url, payload.get("url") or ""),
                            "datePublished": payload.get("datePublished") or payload.get("dateCreated") or "",
                            "summary": payload.get("description") or "",
                        })
            if typ in ("BlogPosting", "Article", "NewsArticle"):
                items.append({
                    "title": obj.get("headline") or obj.get("name") or "Untitled",
                    "link": urljoin(base_url, obj.get("url") or ""),
                    "datePublished": obj.get("datePublished") or "",
                    "summary": obj.get("description") or "",
                })
    # dedupe
    seen, uniq = set(), []
    for it in items:
        href = it.get("link") or ""
        if href and href not in seen:
            seen.add(href)
            uniq.append(it)
    return uniq

def parse_next_data_posts(html: str, base_url: str) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    soup = BeautifulSoup(html, "lxml")
    script = soup.find("script", id="__NEXT_DATA__", type="application/json")
    if not script or not (script.string or script.text):
        return items
    try:
        data = json.loads(script.string or script.text)
    except Exception:
        return items

    def walk(node):
        if isinstance(node, dict):
            title = node.get("title") or node.get("headline") or node.get("name")
            url = node.get("canonical_url") or node.get("url")
            slug = node.get("slug")
            date = node.get("date_published") or node.get("published_at") or node.get("datePublished")
            if (url or slug) and title:
                link = urljoin(base_url, url or ("/p/" + slug))
                items.append({
                    "title": title,
                    "link": link,
                    "datePublished": date or "",
                    "summary": node.get("description") or "",
                })
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(data)
    # same-origin & dedupe
    origin = base_origin(base_url)
    seen, uniq = set(), []
    for it in items:
        href = it.get("link") or ""
        if not href or base_origin(href) != origin:
            continue
        if href not in seen:
            seen.add(href)
            uniq.append(it)
    return uniq

def parse_archive_links(soup: BeautifulSoup, base_url: str) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for sel in [
        "a.post-preview-title",
        "h2 a[href*='/p/']",
        "h3 a[href*='/p/']",
        "article a[href*='/p/']",
        "a[href*='/p/']",
    ]:
        for a in soup.select(sel):
            href = a.get("href") or ""
            if not href:
                continue
            full = urljoin(base_url, href)
            if base_origin(full) != base_origin(base_url):
                continue
            title = a.get_text(strip=True) or a.get("title") or "Untitled"
            # find date nearby
            dt_str = ""
            time_el = a.find("time")
            if not time_el:
                parent = a.parent
                for _ in range(3):
                    if not parent:
                        break
                    time_el = parent.find("time")
                    if time_el:
                        break
                    parent = parent.parent
            if time_el and (time_el.get("datetime") or time_el.text):
                dt_str = time_el.get("datetime") or time_el.get_text(strip=True)
            items.append({"title": title, "link": full, "datePublished": dt_str, "summary": ""})

    # Regex fallback for obfuscated markup
    origin = base_origin(base_url)
    host = urlparse(origin).netloc.replace(".", r"\.")
    regex = re.compile(rf"https?://{host}/p/[a-zA-Z0-9\-_%]+")
    for m in regex.findall(str(soup)):
        full = m
        if base_origin(full) != origin:
            continue
        items.append({"title": "", "link": full, "datePublished": "", "summary": ""})

    # Dedup
    seen, uniq = set(), []
    for it in items:
        href = it["link"]
        if href not in seen:
            seen.add(href)
            uniq.append(it)
    return uniq

def parse_substack_html(content: bytes, page_url: str) -> Tuple[str, List[Dict[str, Any]]]:
    soup = BeautifulSoup(content, "lxml")
    site_title = (soup.title.get_text(strip=True) if soup.title else "My Substack Feed")
    # 1) Next.js
    items = parse_next_data_posts(content.decode("utf-8", "ignore"), page_url)
    if items:
        return site_title, items
    # 2) JSON-LD
    items = parse_jsonld_posts(soup, page_url)
    if items:
        return site_title, items
    # 3) Anchors/regex
    items = parse_archive_links(soup, page_url)
    return site_title, items

def fill_missing_meta(items: List[Dict[str, Any]], ua: str, limit: int = 8):
    """For items missing title/date, fetch a few pages and read OG tags/title."""
    headers = {"User-Agent": ua}
    count = 0
    for it in items:
        if count >= limit:
            break
        need_title = not it.get("title")
        need_date = not it.get("datePublished")
        if not (need_title or need_date):
            continue
        try:
            r = requests.get(it["link"], headers=headers, timeout=20)
            if r.status_code != 200:
                continue
            s = BeautifulSoup(r.text, "lxml")
            if need_title:
                it["title"] = (s.find("meta", property="og:title") or {}).get("content") or \
                              (s.title.get_text(strip=True) if s.title else "Untitled")
            if need_date:
                it["datePublished"] = (s.find("meta", property="article:published_time") or {}).get("content") or \
                                      (s.find("time").get("datetime") if s.find("time") else "")
            count += 1
        except Exception:
            continue

# --------- Rendering ----------

def render_index(feed_title: str, feed_url: str, pub_url: str, items: List[Dict[str, Any]]):
    env = Environment(loader=FileSystemLoader("."), autoescape=select_autoescape(["html", "xml"]))
    tpl = env.get_template(TEMPLATE_FILE.name)
    html = tpl.render(
        site_title=feed_title or "My Substack Feed",
        public_url=pub_url,
        feed_url=feed_url,
        generated_at=datetime.now(timezone.utc),
        items=items,
    )
    (DIST_DIR / "index.html").write_text(html, encoding="utf-8")

# --------- Main ----------

def main():
    ensure_dist()
    feed_url = os.getenv("SUBSTACK_FEED", "https://damii3.substack.com/feed")
    public_url = os.getenv("PUBLIC_SUBSTACK_URL", "https://damii3.substack.com")
    ua = os.getenv("FETCH_UA", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
    item_limit = int(os.getenv("ITEM_LIMIT", "25"))

    print(f"Fetching feed: {feed_url}")
    try:
        content, ctype, final_url = http_get(feed_url, ua, public_url)
    except Exception as e:
        # If network response blocked, try rendered DOM immediately
        if os.getenv("USE_PLAYWRIGHT", "0") == "1":
            print(f"HTTP fetch failed ({e}); trying rendered DOM…")
            html, final_url = playwright_dom(feed_url, ua)
            content, ctype, final_url = html.encode("utf-8"), "text/html", final_url
        else:
            raise

    site_title = "My Substack Feed"
    items: List[Dict[str, Any]] = []

    if is_html_payload(content, ctype):
        print(f"Got HTML from {final_url}; attempting feed autodiscovery...")
        discovered = discover_feed_from_html(content.decode("utf-8", "ignore"), final_url)
        if discovered and discovered != final_url:
            print(f"Discovered feed: {discovered}")
            try:
                content2, ctype2, final2 = http_get(discovered, ua, public_url)
                if not is_html_payload(content2, ctype2):
                    cleaned = XML_INVALID_CTRL_RE.sub(b"", content2)
                    parsed = parse_feed_bytes(cleaned)
                    site_title = (getattr(parsed, "feed", {}) or {}).get("title") or site_title
                    items = normalize_entries(parsed.entries, limit=item_limit)
                else:
                    content, ctype, final_url = content2, ctype2, final2
            except Exception:
                # ignore; continue with HTML scraping
                pass

    if not items:
        if is_html_payload(content, ctype):
            print("No valid RSS; scraping HTML…")
            origin = base_origin(final_url)
            archive_url = urljoin(origin + "/", "archive")

            # 1) Try /archive DOM-rendered
            if os.getenv("USE_PLAYWRIGHT", "0") == "1":
                try:
                    html, arch_final = playwright_dom(archive_url, ua)
                    site_title, html_items = parse_substack_html(html.encode("utf-8"), arch_final)
                    items = normalize_entries(html_items, limit=item_limit)
                except Exception as e:
                    print(f"Rendered /archive failed: {e}", file=sys.stderr)

            # 2) If still nothing, parse current HTML (rendered if we used playwright earlier)
            if not items:
                site_title, html_items = parse_substack_html(content, final_url)
                items = normalize_entries(html_items, limit=item_limit)

            # 3) As a last resort, hit a few post pages to fill missing titles/dates
            if items:
                fill_missing_meta(items, ua, limit=6)
        else:
            cleaned = XML_INVALID_CTRL_RE.sub(b"", content)
            parsed = parse_feed_bytes(cleaned)
            site_title = (getattr(parsed, "feed", {}) or {}).get("title") or site_title
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
</body></html>""",
                encoding="utf-8"
            )
            print("WARN: soft-failed and wrote placeholder page.")
        else:
            print(f"ERROR: {e}", file=sys.stderr)
            sys.exit(1)
