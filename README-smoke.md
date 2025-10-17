Smoke tests
===========

This repository includes two smoke-test helpers:

- `tools/smoke_test.js` — a Puppeteer-based end-to-end smoke test that serves `dist/` locally and runs a headless Chromium to exercise the UI (theme toggle, search, random). It requires Chromium; recommended to run inside a CI or a machine with the necessary system libs.

- `tools/smoke_test_jsdom.js` — a lightweight fallback using `jsdom` to execute the client script in a DOM-like environment. Useful for local quick checks or CI runners without Chromium.

Running locally (recommended):

1. Ensure system libs for Chromium are installed (on Debian/Ubuntu):

```bash
sudo apt update && sudo apt install -y libatk1.0-0 libatk-bridge2.0-0 libcups2 libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libasound2 libnss3 libxss1 libxtst6 libpangocairo-1.0-0 libpango-1.0-0 fonts-liberation libgtk-3-0 libdrm2 ca-certificates
```

2. Install deps and build:

```bash
npm install
pip install jinja2
python3 fetch.py
```

3a. Run full Puppeteer smoke test (requires Chromium):

```bash
node tools/smoke_test.js
```

3b. Or run quick jsdom check (fast, no Chromium):

```bash
node tools/smoke_test_jsdom.js
```
