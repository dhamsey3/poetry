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
    # copy static assets
    static_src = Path("static")
    if static_src.exists():
        shutil.copytree(static_src, DIST_DIR / "static", dirs_exist_ok=True)
        return "static"
    public_src = Path("public")
    if public_src.exists():
        shutil.copytree(public_src, DIST_DIR, dirs_exist_ok=True)
        return "public"
    return None

def _env_trim(name: str, default: str = "") -> str:
    """Return an environment variable with leading/trailing whitespace removed."""
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip()


def _env_multiline(name: str, default: str = "") -> str:
    """Return an environment variable preserving internal newlines."""
    value = os.getenv(name)
    if value is None:
        return default
    normalized = value.replace("\r\n", "\n").replace("\r", "\n")
    return normalized.strip("\n")


def render_index(site_title: str, feed_url: str, public_url: str, proxy_url: str):
    env = Environment(
        loader=FileSystemLoader("."),
        autoescape=select_autoescape(["html", "xml"])
    )
    tpl = env.get_template(TEMPLATE_FILE.name)
    ebook_default_url = ""
    if public_url:
        ebook_default_url = public_url.rstrip("/") + "/p/torchborne-poetry-ebook"
    featured_ebook = {
        "title": _env_trim("EBOOK_TITLE", "Torchborne Poetry eBook"),
        "description": _env_trim(
            "EBOOK_DESCRIPTION",
            "A lovingly curated digital chapbook—now available on Amazon Kindle.",
        ),
        "url": _env_trim("EBOOK_URL", ebook_default_url),
        "cta_text": _env_trim("EBOOK_CTA_TEXT", "Read eBook"),
        "note": _env_multiline("EBOOK_NOTE"),
        "tag": _env_trim("EBOOK_TAG", "Featured"),
        "cover": _env_trim("EBOOK_COVER"),
        "pub_date": _env_trim("EBOOK_PUB_DATE"),
        "meta": _env_trim("EBOOK_META", "Amazon Kindle Edition"),
        "share_text": _env_trim("EBOOK_SHARE_TEXT", "Share"),
        "preview_title": _env_trim("EBOOK_PREVIEW_TITLE"),
        "preview_html": _env_multiline("EBOOK_PREVIEW_HTML"),
        "preview_button_text": _env_trim("EBOOK_PREVIEW_BUTTON_TEXT"),
    }
    if not featured_ebook["url"]:
        featured_ebook = {}
    html = tpl.render(
        site_title=site_title or "torchborne",
        public_url=public_url,
        feed_url=feed_url,
        rss_proxy_url=(proxy_url or "").rstrip("?&"),
        featured_ebook=featured_ebook,
        generated_at=datetime.now(timezone.utc),
        items=[]  # client-side populates
    )
    (DIST_DIR / "index.html").write_text(html, encoding="utf-8")

def main():
    copied = ensure_dist()
    feed_url   = os.getenv("SUBSTACK_FEED", "https://versesvibez.substack.com/feed")
    public_url = os.getenv("PUBLIC_SUBSTACK_URL", "https://versesvibez.substack.com/")
    proxy_url  = os.getenv("RSS_PROXY_URL", "https://api.rss2json.com/v1/api.json?rss_url=")
    site_title = os.getenv("SITE_TITLE", "torchborne")
    render_index(site_title, feed_url, public_url, proxy_url)
    msg = "Wrote dist/index.html"
    if copied:
        msg += f" and copied {copied}/ → dist/"
    print(msg)

if __name__ == "__main__":
    main()
