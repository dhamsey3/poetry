#!/usr/bin/env python3
import os
import sys
from pathlib import Path
from datetime import datetime, timezone
from typing import List, Dict, Any

import requests
import feedparser
from dateutil import parser as dparser
from jinja2 import Environment, FileSystemLoader, select_autoescape

DIST_DIR = Path("dist")
TEMPLATE_FILE = Path("index.html.j2")

# Set SOFT_FAIL=1 in repo variables if you prefer a placeholder page over a failed build
SOFT_FAIL = os.getenv("SOFT_FAIL", "0") == "1"

def ensure_dist():
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    # Skip Jekyll on Pages
    (DIST_DIR / ".nojekyll").write_text("", encoding="utf-8")

def http_get(url: str, ua: str, referer: str) -> bytes:
    """Fetch URL with strong headers + small retry; fall back to Playwright when enabled."""
    import time, random
    headers = {
        "User-Agent": ua or "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Accept": "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
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
        r = s.get(url, headers=headers, timeout=30)
        last_status = r.status_code
        if r.status_code == 200:
            return r.content
        if r.status_code in (403, 429):
            time.sleep(1.5 + random.random())  # jitter
            continue
        break

    if os.getenv("USE_PLAYWRIGHT", "0") == "1":
        try:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                context = browser.new_context(user_agent=ua)
                page = context.new_page()
                page.set_extra_http_headers({
                    "Accept": headers["Accept"],
                    "Accept-Language": headers["Accept-Language"],
                    "Referer": headers["Referer"],
                    "DNT": headers["DNT"],
                })
                page.goto(url, timeout=45000, wait_until="load")
                content = page.content().encode("utf-8")
                browser.close()
            return content
        except Exception as e:
            raise RuntimeError(f"Failed after HTTP {last_status}; Playwright fallback error: {e}") from e

    raise RuntimeError(f"Failed to fetch feed: HTTP {last_status} from {url}")

def parse_feed(xml_bytes: bytes) -> Any:
    data = feedparser.parse(xml_bytes)
    if data.bozo and not data.entries:
        raise RuntimeError(f"Feed parse error: {data.bozo_exception}")
    return data

def to_iso(dt) -> str:
    if hasattr(dt, 'tzinfo'):
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
                from datetime import datetime, timezone
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
    # Sort newest first
    from datetime import datetime as _dt
    norm.sort(key=lambda x: x["date"] or _dt.min.replace(tzinfo=timezone.utc), reverse=True)
    return norm[:limit]

def render_index(feed_title: str, feed_url: str, pub_url: str, items: List[Dict[str, Any]]):
    env = Environment(
        loader=FileSystemLoader("."),
        autoescape=select_autoescape(["html", "xml"]),
    )
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
    xml = http_get(feed_url, ua, public_url)
    parsed = parse_feed(xml)
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
