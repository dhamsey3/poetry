from __future__ import annotations

import os
import shutil
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import urlparse

from jinja2 import Environment, FileSystemLoader, select_autoescape
from jinja2.exceptions import TemplateNotFound

DIST_DIR = Path("dist")
TEMPLATE_FILE = Path("index.html.j2")


def ensure_dist() -> list[str]:
    """Ensure ./dist exists, drop .nojekyll, and copy assets."""
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    (DIST_DIR / ".nojekyll").write_text("", encoding="utf-8")

    copied: list[str] = []

    public_src = Path("public")
    if public_src.exists():
        shutil.copytree(public_src, DIST_DIR, dirs_exist_ok=True)
        copied.append("public/")

        # Ensure JS from public/ ends up under dist/static/js so templates
        # that reference ./static/js/main.js will resolve. Some builds put
        # client scripts in public/js while templates expect static/js.
        public_js = public_src / "js"
        if public_js.exists():
            target_js = DIST_DIR / "static" / "js"
            target_js.mkdir(parents=True, exist_ok=True)
            shutil.copytree(public_js, target_js, dirs_exist_ok=True)
            # Also record that we copied these JS files for logging
            if "static/" not in copied:
                copied.append("static/")

    static_src = Path("static")
    if static_src.exists():
        (DIST_DIR / "static").mkdir(parents=True, exist_ok=True)
        shutil.copytree(static_src, DIST_DIR / "static", dirs_exist_ok=True)
        copied.append("static/")

    return copied


def _env_trim(name: str, default: str = "") -> str:
    value = os.getenv(name)
    return default if value is None else value.strip()


def _is_kindle_url(url: str) -> bool:
    """Accept only Amazon Kindle product/store URLs."""
    if not url:
        return False
    try:
        host = urlparse(url).hostname or ""
    except Exception:
        return False
    host = host.lower()
    return host.endswith(".amazon.com") or host.endswith(".amazon.co.uk") or \
           host.endswith(".amazon.ca") or host.endswith(".amazon.de") or \
           host.endswith(".amazon.fr") or host.endswith(".amazon.es") or \
           host.endswith(".amazon.it") or host.endswith(".amazon.com.au") or \
           host.endswith(".amazon.in") or host.endswith(".amazon.co.jp") or \
           host.endswith(".amazon.com.br") or host.endswith(".amazon.com.mx") or \
           host.endswith(".amazon.nl") or host.endswith(".amazon.se") or \
           host.endswith(".amazon.pl") or host.endswith(".amazon.sg")


def render_index(site_title: str, feed_url: str, public_url: str, proxy_url: str) -> None:
    template_dir = TEMPLATE_FILE.parent if TEMPLATE_FILE.parent != Path("") else Path(".")

    env = Environment(
        loader=FileSystemLoader(str(template_dir)),
        autoescape=select_autoescape(
            enabled_extensions=("html", "htm", "xml", "xhtml", "j2", "jinja", "jinja2"),
            default=True,
        ),
    )

    try:
        tpl = env.get_template(TEMPLATE_FILE.name)
    except TemplateNotFound as e:
        raise SystemExit(f"Template not found: {TEMPLATE_FILE} (searched in {template_dir})") from e

    # Require an explicit Amazon Kindle URL for the CTA
    kindle_url = _env_trim("EBOOK_KINDLE_URL", "")
    featured_ebook = {}
    if _is_kindle_url(kindle_url):
        # Use keys expected by the UI template (featured.cover_url, featured.ebook_url, featured.url)
        featured_ebook = {
            "title": _env_trim("EBOOK_TITLE", "Torchborne Poetry eBook"),
            "description": _env_trim("EBOOK_DESCRIPTION", "A lovingly curated selection of Torchborne poems."),
            "ebook_url": kindle_url,  # official download/CTA link
            "url": kindle_url,        # primary link used for "Read" actions
            "cover_url": _env_trim("EBOOK_COVER", ""),
            "tag": _env_trim("EBOOK_TAG", "Featured"),
            "meta": _env_trim("EBOOK_META", "Poetry eBook"),
            "note": _env_trim("EBOOK_NOTE", ""),
            "ctaText": _env_trim("EBOOK_CTA_TEXT", "Read on Kindle"),
            "shareText": _env_trim("EBOOK_SHARE_TEXT", "Share eBook"),
        }

    posts_base = (public_url or "https://versesvibez.substack.com/").rstrip("/")
    subscribe_url = f"{posts_base}/subscribe"
    static_base = "./static/"
    static_pub = (posts_base + "/static/") if public_url else static_base
    rss2json_api_key = _env_trim("RSS2JSON_API_KEY", "")
    try:
        max_items = int(_env_trim("MAX_ITEMS", "50") or 50)
    except ValueError:
        max_items = 50

    html = tpl.render(
        site_title=site_title or "torchborne",
        public_url=public_url,
        PUBLIC_URL=public_url,
        feed_url=feed_url,
        rss_proxy_url=(proxy_url or "").rstrip("?&"),
        featured=featured_ebook,  # template expects `featured`
        generated_at=datetime.now(timezone.utc),
        generated_at_iso=datetime.now(timezone.utc).isoformat(),
        posts=[],
        display_date=None,
        POSTS_BASE=posts_base,
        SUBSCRIBE_URL=subscribe_url,
        static_base=static_base,
        STATICPUB=static_pub,
        rss2json_api_key=rss2json_api_key,
        max_items=max_items,
    )

    (DIST_DIR / "index.html").write_text(html, encoding="utf-8")


def main() -> int:
    copied = ensure_dist()

    feed_url = os.getenv("SUBSTACK_FEED", "https://versesvibez.substack.com/feed")
    public_url = os.getenv("PUBLIC_SUBSTACK_URL", "https://versesvibez.substack.com/")
    proxy_url = os.getenv("RSS_PROXY_URL", "https://api.rss2json.com/v1/api.json?rss_url=")
    site_title = os.getenv("SITE_TITLE", "torchborne")

    render_index(site_title, feed_url, public_url, proxy_url)

    msg = "Wrote dist/index.html"
    if copied:
        msg += " and copied " + ", ".join(copied) + "→ dist/"
    print(msg)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
