#!/usr/bin/env python3
import os
import sys
import re
from pathlib import Path
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional, Tuple
from urllib.parse import urljoin, urlparse

import requests
import feedparser
from bs4 import BeautifulSoup
from dateutil import parser as dparser
from jinja2 import Environment, FileSystemLoader, select_autoescape

DIST_DIR = Path("dist")
TEMPLATE_FILE = Path("index.html.j2")

# Flags controlled by CI
SOFT_FAIL   = os.getenv("SOFT_FAIL", "0") == "1"
ALLOW_EMPTY = os.getenv("ALLOW_EMPTY", "0") == "1"
USE_PW      = os.getenv("USE_PLAYWRIGHT", "0") == "1"

XML_INVALID_CTRL_RE = re.compile(rb"[\x00-\x08\x0B\x0C\x0E-\x1F]")

def ensure_dist():
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    (DIST_DIR / ".nojekyll").write_text("", encoding="utf-8")

def is_html_payload(content: bytes, content_type: str) -> bool:
    if content_type and "html" in content_type.lower():
        return True
    head = content[:200].lstrip().lower()
    return head.startswith(b"<!doctype html") or head.startswith(b"<html")

def http_get(url: str, ua: str, referer: str) -> Tuple[bytes, str, str]:
    headers = {
        "User-Agent": ua,
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
    for _ in range(3):
        r = s.get(url, headers=headers, timeout=30, allow_redirects=True)
        last_status = r.status_code
        if r.status_code == 200:
            return r.content, r.headers.get("content-type", ""), r.url
        if r.status_code in (403, 429):
            import time, random
            time.sleep(1.2 + random.random())
            continue
        break
    raise RuntimeError(f"Failed to fetch URL (last status {last_status}): {url}")

def base_origin(u: str) -> str:
    p = urlparse(u)
    return f"{p.scheme}://{p.netloc}"

# -------- Playwright helpers (used only when USE_PLAYWRIGHT=1) --------
def playwright_dom(url: str, ua: str, wait_selector: Optional[str] = None, timeout_ms: int = 90000) -> Tuple[str, str]:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(user_agent=ua)
        page = context.new_page()
        page.goto(url, timeout=timeout_ms, wait_until="domcontentloaded")
        if wait_selector:
            try:
                page.wait_for_selector(wait_selector, timeout=15000)
            except Exception:
                pass
        else:
            try:
                page.wait_for_selector("script#__NEXT_DATA__, a[href*='/p/']", timeout=15000)
            except Exception:
                pass
        page.wait_for_timeout(1500)
        html = page.content()
        final = page.url
        browser.close()
    return html, final

# ----------------- Parsers -----------------
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
    from datetime import datetime as _dt
    norm.sort(key=lambda x: x["date"] or _dt.min.replace(tzinfo=timezone.utc), reverse=True)
    return norm[:limit]

def parse_html_list(content: bytes, page_url: str) -> Tuple[str, List[Dict[str, Any]]]:
    soup = BeautifulSoup(content, "lxml")
    site_title = (soup.title.get_text(strip=True) if soup.title else "My Substack Feed")
    items: List[Dict[str, Any]] = []
    # JSON-LD first
    for tag in soup.find_all("script", attrs={"type": "application/ld+json"}):
        try:
            import json
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
                if node.get("@type") in ("BlogPosting", "Article", "NewsArticle"):
                    items.append({
                        "title": node.get("headline") or node.get("name") or "Untitled",
                        "link": urljoin(page_url, node.get("url") or ""),
                        "datePublished": node.get("datePublished") or "",
                        "summary": node.get("description") or "",
                    })
                for v in node.values():
                    stack.append(v)
            elif isinstance(node, list):
                stack.extend(node)
    # Anchor heuristics as fallback
    if not items:
        for sel in ["a.post-preview-title", "h2 a[href*='/p/']", "h3 a[href*='/p/']", "article a[href*='/p/']",
                    "a[href*='/p/']"]:
            for a in soup.select(sel):
                href = a.get("href") or ""
                if not href:
                    continue
                full = urljoin(page_url, href)
                title = a.get_text(strip=True) or a.get("title") or "Untitled"
                dt = ""
                t = a.find("time")
                if not t:
                    par = a.parent
                    for _ in range(3):
                        if not par:
                            break
                        t = par.find("time")
                        if t:
                            break
                        par = par.parent
                if t and (t.get("datetime") or t.text):
                    dt = t.get("datetime") or t.get_text(strip=True)
                items.append({"title": title, "link": full, "datePublished": dt, "summary": ""})
    # Dedupe
    seen, uniq = set(), []
    for it in items:
        href = it.get("link") or ""
        if href and href not in seen:
            seen.add(href)
            uniq.append(it)
    return site_title, uniq

# ----------------- Rendering -----------------
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

# ----------------- Main -----------------
def main():
    ensure_dist()
    # Set your publication defaults
    feed_url = os.getenv("SUBSTACK_FEED", "https://versesvibez.substack.com/feed")
    public_url = os.getenv("PUBLIC_SUBSTACK_URL", "https://versesvibez.substack.com/")
    ua = os.getenv("FETCH_UA", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
    item_limit = int(os.getenv("ITEM_LIMIT", "25"))

    print(f"Fetching feed: {feed_url}")

    items: List[Dict[str, Any]] = []
    site_title = "My Substack Feed"

    # Try RSS first
    try:
        content, ctype, final_url = http_get(feed_url, ua, public_url)
        if not is_html_payload(content, ctype):
            cleaned = XML_INVALID_CTRL_RE.sub(b"", content)
            parsed = parse_feed_bytes(cleaned)
            site_title = (getattr(parsed, "feed", {}) or {}).get("title") or site_title
            items = normalize_entries(parsed.entries, limit=item_limit)
        else:
            # If RSS URL returned HTML, treat like blocked and fall through
            pass
    except Exception as e:
        print(f"HTTP fetch failed ({e}); trying rendered DOM…")

    # If blocked or empty and Playwright is enabled, try rendered archive/home
    if not items and USE_PW:
        try:
            # Prefer /archive (more structured)
            origin = base_origin(feed_url)
            archive_url = urljoin(origin + "/", "archive")
            html, arch_final = playwright_dom(archive_url, ua, wait_selector="a[href*='/p/']")
            site_title, html_items = parse_html_list(html.encode("utf-8"), arch_final)
            items = normalize_entries(html_items, limit=item_limit)
        except Exception as e:
            print(f"Rendered /archive failed: {e}", file=sys.stderr)
            try:
                html, final_url = playwright_dom(public_url, ua)
                site_title, html_items = parse_html_list(html.encode("utf-8"), final_url)
                items = normalize_entries(html_items, limit=item_limit)
            except Exception as e2:
                print(f"Rendered homepage failed: {e2}", file=sys.stderr)

    print(f"Parsed {len(items)} items")

    # ----- Fallbacks: last good index or placeholder -----
    if not items:
        prev = Path("dist/index.previous.html")
        if prev.exists():
            ensure_dist()
            (DIST_DIR / "index.html").write_text(prev.read_text(encoding="utf-8"), encoding="utf-8")
            print("WARN: no items; served last good index.html from previous gh-pages deployment.")
            print("Wrote dist/index.html")
            return

        if SOFT_FAIL or ALLOW_EMPTY:
            ensure_dist()
            (DIST_DIR / "index.html").write_text(
                """<html><body>
<h1>No posts available</h1>
<p>The source feed is temporarily unavailable or returned no public items. Please try again later.</p>
</body></html>""",
                encoding="utf-8"
            )
            print("WARN: no items; wrote placeholder page due to SOFT_FAIL/ALLOW_EMPTY.")
            print("Wrote dist/index.html")
            return

        # Only fail if we explicitly don't allow soft success
        raise RuntimeError("No items found from RSS or HTML fallback.")

    # Normal render
    render_index(site_title, feed_url, public_url, items)
    print("Wrote dist/index.html")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        if SOFT_FAIL or ALLOW_EMPTY:
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
