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
TEMPLATE_FILE = Path("index.html.j2")  # template at repo root

def ensure_dist():
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    (DIST_DIR / ".nojekyll").write_text("", encoding="utf-8")

def http_get(url: str, ua: str) -> bytes:
    headers = {
        "User-Agent": ua or "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36",
        "Accept": "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
    }
    r = requests.get(url, headers=headers, timeout=30)
    if r.status_code == 200:
        return r.content

    # Optional: Playwright fallback if enabled by repo variable USE_PLAYWRIGHT=1
    if os.getenv("USE_PLAYWRIGHT", "0") == "1":
        try:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                page = browser.new_page(user_agent=ua)
                page.goto(url, timeout=45000, wait_until="load")
                content = page.content().encode("utf-8")
                browser.close()
            return content
        except Exception as e:
            raise RuntimeError(f"HTTP {r.status_code} and Playwright fallback failed: {e}") from e

    raise RuntimeError(f"Failed to fetch feed: HTTP {r.status_code} from {url}")

def parse_feed(xml_bytes: bytes) -> Any:
    data = feedparser.parse(xml_bytes)
    if data.bozo and not data.entries:
        raise RuntimeError(f"Feed parse error: {data.bozo_exception}")
    return data

def to_iso(dt) -> str:
    if isinstance(dt, datetime):
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
            dt = datetime(*e.published_parsed[:6], tzinfo=timezone.utc)
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
    xml = http_get(feed_url, ua)
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
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
