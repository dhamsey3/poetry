# Static Poetry site (Torchborne) 

Minimal, single-page reader for a Substack (or any RSS) feed.  
Renders a Jinja template to `dist/` and (optionally) uses a Cloudflare Worker as a tiny RSS→JSON proxy.

## Features
- One file UI (cards, quick-read modal, search, dark/light).
- Secure HTML sanitization.
- Optional edge cache proxy (10-min).

## Usage
```bash
npm install
python3 -m venv .venv
./.venv/bin/python -m pip install -r requirements.txt
export SITE_TITLE="Torchborne"
export SUBSTACK_FEED="https://YOUR.substack.com/feed"
export PUBLIC_SUBSTACK_URL="https://YOUR.substack.com/"
export RSS_PROXY_URL="https://your-worker.example/?rss_url="  # optional
npm run build
cd dist && python -m http.server 8080

# Optional: Featured eBook spotlight
# export EBOOK_URL="https://your.substack.com/p/your-ebook"
# export EBOOK_TITLE="Your Poetry eBook"
# export EBOOK_DESCRIPTION="Short blurb that appears in the featured card"
```

## Styling
Tailwind compiles from `public/static/tailwind.input.css` into `public/static/tailwind.css`.
The hand-written editorial theme still lives in `public/static/styles.css`, so Tailwind utilities can be added gradually without rewriting the whole UI.
