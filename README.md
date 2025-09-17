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
python fetch.py
cd dist && python -m http.server 8080

# Optional: Featured eBook spotlight
# export EBOOK_URL="https://your.substack.com/p/your-ebook"
# export EBOOK_TITLE="Your Poetry eBook"
# export EBOOK_DESCRIPTION="Short blurb that appears in the featured card"

