#!/usr/bin/env python3
import os
import sys
import re
from urllib.parse import urljoin
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

# Set SOFT_FAIL=1 in repo Variables if you prefer a placeholder page over a failed build
SOFT_FAIL = os.getenv("SOFT_FAIL", "0") == "1"

# Drop XML-invalid control chars (common cause of "invalid token")
XML_INVALID_CTRL_RE = re.compile(rb"[\x00-\x08\x0B\x0C\x0E-\x1F]")

def ensure_dist():
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    (DIST_DIR / ".nojekyll").write_text("", encoding="utf-8")

def is_html_payload(content: bytes, content_type: str) -> bool:
    if content_type and "html" in content_type.lower():
        return True
    head = content[:200].lstrip()
    return head.startswith(b"<!doctype html") or head.startswith(b"<html")

def discover_feed_from_html(html: str, base_url: str) -> Optional[str]:
    soup = BeautifulSoup(html, "html.parser")
    # Look for RSS/Atom <link> discovery
    for link in soup.find_all("link"):
        rel = (link.get("rel") or [])
        rel = [r.lower() for r in rel] if isinstance(rel, list) else [str(rel).lower()]
        type_attr = (link.get("type") or "").lower()
        href = link.get("href")
        if not href:
            continue
        if ("alternate" in rel) and (
            "rss" in type_attr or "atom" in type_attr or type_attr.endswith("xml")
        ):
            return urljoin(base_url, href)
    # Heuristic fallbacks
    for candidate in ("feed", "rss", "feed.xml", "rss.xml"):
        return urljoin(base_url.rstrip("/") + "/", candidate)
    return None

def http_get(url: str, ua: str, referer: str) -> Tuple[bytes, str, str]:
    """Return (content, content_type, final_url). Uses Playwright if enabled."""
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
    # Jittered retries for 403/429
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

    if os.getenv("USE_PLAYWRIGHT", "0") == "1":
        try:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                context = browser.new_context(user_agent=ua)
                page = context.new_page()
                resp = page.goto(url, timeout=45000, wait_until="load")
                if resp:
                    body = resp.body()
                    ctype = resp.headers.get("content-type", "")
                    final_url = resp.url
                else:
                    # Fallback to DOM content if no response object
                    body = page.content().encode("utf-8")
                    ctype = "text/html"
                    final_url = page.url
                browser.close()
            return body, ctype, final_url
        except Exception as e:
            raise RuntimeError(f"Failed after HTTP {last_status}; Playwright fallback error: {e}") from e

    raise RuntimeError(f"Failed to fetch feed: HTTP {last_status} from {url}")

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
        for key in ("published", "updated", "created"):
            val = e.get(key)
            if val:
                try:
                    dt = dparser.parse(val)
                    break
                except Exception:
                    pass
        if not dt and e.get("published_parsed"):
            try:
                dt = datetime(*e.published_parsed[:6], tzinfo=timezone.utc)
            except Exception:
                dt = None
        summary = e.get("summary", "")
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

def main():
    ensure_dist()
    feed_url = os.getenv("SUBSTACK_FEED", "https://damii3.substack.com/feed")
    public_url = os.getenv("PUBLIC_SUBSTACK_URL", "https://damii3.substack.com")
    ua = os.getenv("FETCH_UA", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
    item_limit = int(os.getenv("ITEM_LIMIT", "25"))

    print(f"Fetching feed: {feed_url}")
    content, ctype, final_url = http_get(feed_url, ua, public_url)

    # If we got HTML (block page), try to auto-discover a real feed
    if is_html_payload(content, ctype):
        print(f"Got HTML from {final_url}; attempting feed autodiscovery...")
        discovered = discover_feed_from_html(content.decode("utf-8", "ignore"), final_url)
        if discovered and discovered != final_url:
            print(f"Discovered feed: {discovered}")
            content, ctype, final_url = http_get(discovered, ua, public_url)
        else:
            print("No feed link discovered in HTML; will attempt to parse after sanitization.")

    # Sanitize invalid XML control chars and try parsing
    cleaned = XML_INVALID_CTRL_RE.sub(b"", content)
    try:
        parsed = parse_feed_bytes(cleaned)
    except Exception as e:
        # As a last resort: if still HTML, soft fail or raise
        head = cleaned[:200].lstrip().lower()
        if head.startswith(b"<!doctype html") or head.startswith(b"<html"):
            raise RuntimeError("Received HTML instead of RSS/Atom.") from e
        raise

    title = (getattr(parsed, "feed", {}) or {}).get("title") or "My Substack Feed"
    items = normalize_entries(parsed.entries, limit=item_limit)
    print(f"Parsed {len(items)} items")
    render_index(title, feed_url, public_url, items)
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
