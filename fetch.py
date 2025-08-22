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
        if ("alternate" in rel) and (
            "rss" in type_attr or "atom" in type_attr or "xml" in type_attr
        ):
            return urljoin(base_url, href)
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
                    body = page.content().encode("utf-8")
                    ctype = "text/html"
                    final_url = page.url
                browser.close()
            return body, ctype, final_url
        except Exception as e:
            raise RuntimeError(f"Failed after HTTP {last_status}; Playwright fallback error: {e}") from e

    raise RuntimeError(f"Failed to fetch URL (last status {last_status}): {url}")

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
        if not dt and e.get("published_parsed"):
            try:
                dt = datetime(*e.published_parsed[:6], tzinfo=timezone.utc)
            except Exception:
                dt = None
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

# ---------- HTML Fallback Parsing (Substack) ----------

def parse_jsonld_posts(soup: BeautifulSoup, base_url: str) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for tag in soup.find_all("script", attrs={"type": "application/ld+json"}):
        try:
            data = json.loads(tag.string or tag.text or "")
        except Exception:
            continue

        # Normalize to list to simplify processing
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
            typ = obj.get("@type") or obj.get("@type".lower())
            # ItemList lists posts via itemListElement
            if typ in ("ItemList",):
                elements = obj.get("itemListElement") or []
                for el in elements:
                    if isinstance(el, dict):
                        # May be {"@type":"ListItem","item":{...}} or flat
                        payload = el.get("item") if "item" in el else el
                        if isinstance(payload, dict):
                            items.append({
                                "title": payload.get("name") or payload.get("headline") or "Untitled",
                                "link": urljoin(base_url, payload.get("url") or ""),
                                "datePublished": payload.get("datePublished") or payload.get("dateCreated") or "",
                                "summary": payload.get("description") or "",
                            })
            # Blog with blogPost array
            if typ in ("Blog", "WebSite") and isinstance(obj.get("blogPost"), list):
                for post in obj["blogPost"]:
                    if isinstance(post, dict):
                        items.append({
                            "title": post.get("headline") or post.get("name") or "Untitled",
                            "link": urljoin(base_url, post.get("url") or ""),
                            "datePublished": post.get("datePublished") or "",
                            "summary": post.get("description") or "",
                        })
            # Individual BlogPosting
            if typ in ("BlogPosting", "Article", "NewsArticle"):
                items.append({
                    "title": obj.get("headline") or obj.get("name") or "Untitled",
                    "link": urljoin(base_url, obj.get("url") or ""),
                    "datePublished": obj.get("datePublished") or "",
                    "summary": obj.get("description") or "",
                })
    # Deduplicate by link
    seen = set()
    uniq = []
    for it in items:
        href = it.get("link") or ""
        if not href or href in seen:
            continue
        seen.add(href)
        uniq.append(it)
    return uniq

def parse_archive_links(soup: BeautifulSoup, base_url: str) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    # Generic: anchors to posts often contain '/p/' in Substack
    for a in soup.select("a[href]"):
        href = a.get("href") or ""
        if not href:
            continue
        full = urljoin(base_url, href)
        # Heuristic: keep same host, paths with '/p/' (post), ignore archive/about
        if base_origin(full) != base_origin(base_url):
            continue
        path = urlparse(full).path.lower()
        if "/p/" not in path:
            continue
        title = a.get_text(strip=True)
        if not title:
            # try title attribute
            title = a.get("title") or ""
        if not title:
            continue
        # Find date near the link (time tag)
        dt_str = ""
        time_el = a.find("time")
        if not time_el:
            # look up to two parents
            parent = a.parent
            for _ in range(2):
                if not parent:
                    break
                time_el = parent.find("time")
                if time_el:
                    break
                parent = parent.parent
        if time_el and (time_el.get("datetime") or time_el.text):
            dt_str = time_el.get("datetime") or time_el.get_text(strip=True)
        items.append({
            "title": title,
            "link": full,
            "datePublished": dt_str,
            "summary": "",
        })
    # Deduplicate by link, keep order
    seen = set()
    uniq = []
    for it in items:
        href = it["link"]
        if href in seen:
            continue
        seen.add(href)
        uniq.append(it)
    return uniq

def parse_substack_html(content: bytes, page_url: str) -> Tuple[str, List[Dict[str, Any]]]:
    soup = BeautifulSoup(content, "lxml")
    # Title from page <title>
    site_title = (soup.title.get_text(strip=True) if soup.title else "My Substack Feed")
    # 1) JSON-LD first
    items = parse_jsonld_posts(soup, page_url)
    # 2) Fallback to anchors (archive pages)
    if not items:
        items = parse_archive_links(soup, page_url)
    return site_title, items

# ---------- Rendering ----------

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

# ---------- Main ----------

def main():
    ensure_dist()
    feed_url = os.getenv("SUBSTACK_FEED", "https://damii3.substack.com/feed")
    public_url = os.getenv("PUBLIC_SUBSTACK_URL", "https://damii3.substack.com")
    ua = os.getenv("FETCH_UA", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
    item_limit = int(os.getenv("ITEM_LIMIT", "25"))

    print(f"Fetching feed: {feed_url}")
    content, ctype, final_url = http_get(feed_url, ua, public_url)

    site_title = "My Substack Feed"
    items: List[Dict[str, Any]] = []

    # If we got HTML (bot wall), try to auto-discover a real feed
    if is_html_payload(content, ctype):
        print(f"Got HTML from {final_url}; attempting feed autodiscovery...")
        discovered = discover_feed_from_html(content.decode("utf-8", "ignore"), final_url)
        if discovered and discovered != final_url:
            print(f"Discovered feed: {discovered}")
            content2, ctype2, final2 = http_get(discovered, ua, public_url)
            if not is_html_payload(content2, ctype2):
                cleaned = XML_INVALID_CTRL_RE.sub(b"", content2)
                parsed = parse_feed_bytes(cleaned)
                site_title = (getattr(parsed, "feed", {}) or {}).get("title") or site_title
                items = normalize_entries(parsed.entries, limit=item_limit)
            else:
                # Still HTML → fall through to HTML scraping below using discovered URL page
                content, ctype, final_url = content2, ctype2, final2

    if not items:
        if is_html_payload(content, ctype):
            print("No valid RSS; scraping HTML…")
            # If current page isn’t archive, try /archive first (more structured)
            origin = base_origin(final_url)
            archive_url = urljoin(origin + "/", "archive")
            if not final_url.rstrip("/").endswith("/archive"):
                try:
                    arch_body, arch_ctype, arch_final = http_get(archive_url, ua, public_url)
                    if is_html_payload(arch_body, arch_ctype):
                        site_title, html_items = parse_substack_html(arch_body, arch_final)
                        items = normalize_entries(html_items, limit=item_limit)
                except Exception as e:
                    print(f"Archive fetch failed: {e}", file=sys.stderr)
            # If still nothing, parse the current HTML
            if not items:
                site_title, html_items = parse_substack_html(content, final_url)
                items = normalize_entries(html_items, limit=item_limit)
        else:
            # We have XML but parsing not attempted yet
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
