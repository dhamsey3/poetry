# Static Poetry site (Torchborne) 

Minimal, single-page reader for a Substack (or any RSS) feed.  
Renders a Jinja template to `dist/` and (optionally) uses a Cloudflare Worker as a tiny RSS→JSON proxy.

## Features
- One file UI (cards, quick-read modal, search, dark/light).
- Secure HTML sanitization.
- Optional edge cache proxy (10-min).

## Usage
```bash
pip install jinja2
export SITE_TITLE="Torchborne"
export SUBSTACK_FEED="https://YOUR.substack.com/feed"
export PUBLIC_SUBSTACK_URL="https://YOUR.substack.com/"
export RSS_PROXY_URL="https://your-worker.example/?rss_url="  # optional
python build.py
cd dist && python -m http.server 8080

# Optional: Featured eBook spotlight
# export EBOOK_URL="https://your.substack.com/p/your-ebook"
# export EBOOK_TITLE="Your Poetry eBook"
# export EBOOK_DESCRIPTION="Short blurb that appears in the featured card"
# export EBOOK_CTA_TEXT="Read eBook"
# export EBOOK_NOTE="Optional dedication or note shown with the preview"
# export EBOOK_PREVIEW_TITLE="Sneak Peek"
# export EBOOK_PREVIEW_HTML="<p>First line of the poem</p><p>Second line of the poem</p>"
# export EBOOK_PREVIEW_BUTTON_TEXT="Read sample"
# export EBOOK_POEM_TITLE="Featured Poem"
# export EBOOK_POEM_TEXT=$'first line of the poem\nsecond line of the poem'
