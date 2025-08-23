#!/usr/bin/env python3
import os
import shutil
from pathlib import Path
from datetime import datetime, timezone
from jinja2 import Environment, FileSystemLoader, select_autoescape

DIST_DIR = Path("dist")
TEMPLATE_FILE = Path("index.html.j2")

def ensure_dist():
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    # prevent Jekyll processing on GH Pages
    (DIST_DIR / ".nojekyll").write_text("", encoding="utf-8")
    # copy static assets -> dist/static (so use src="static/…")
    static_src = Path("static")
    static_dst = DIST_DIR / "static"
    if static_src.exists():
        shutil.copytree(static_src, static_dst, dirs_exist_ok=True)

def render_index(site_title: str, feed_url: str, public_url: str, proxy_url: str):
    env = Environment(
        loader=FileSystemLoader("."),
        autoescape=select_autoescape(["html", "xml"])
    )
    tpl = env.get_template(TEMPLATE_FILE.name)
    html = tpl.render(
        site_title=site_title or "torchborne",
        public_url=public_url,
        feed_url=feed_url,
        rss_proxy_url=(proxy_url or "").rstrip("?&"),
        generated_at=datetime.now(timezone.utc),
        items=[]  # client-side populates
    )
    (DIST_DIR / "index.html").write_text(html, encoding="utf-8")

def main():
    ensure_dist()
    feed_url   = os.getenv("SUBSTACK_FEED", "https://versesvibez.substack.com/feed")
    public_url = os.getenv("PUBLIC_SUBSTACK_URL", "https://versesvibez.substack.com/")
    proxy_url  = os.getenv("RSS_PROXY_URL", "https://api.rss2json.com/v1/api.json?rss_url=")
    site_title = os.getenv("SITE_TITLE", "torchborne")
    render_index(site_title, feed_url, public_url, proxy_url)
    print("Wrote dist/index.html and copied static/ → dist/static")

if __name__ == "__main__":
    main()
