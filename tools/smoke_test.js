const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

async function serveStatic(dir, port=0) {
  const server = http.createServer((req, res) => {
    let p = path.join(dir, decodeURIComponent(req.url.split('?')[0]));
    if (p.endsWith('/')) p = path.join(p, 'index.html');
    fs.readFile(p, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      const ext = path.extname(p).toLowerCase();
      const map = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png' };
      res.writeHead(200, { 'content-type': map[ext] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve, reject) => {
    server.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

(async () => {
  const dist = path.resolve(__dirname, '..', 'dist');
  if (!fs.existsSync(dist)) { console.error('dist/ not found'); process.exit(2); }
  const { server, port } = await serveStatic(dist);
  const url = `http://127.0.0.1:${port}/`;
  console.log('Serving', dist, 'on', url);

  const browser = await puppeteer.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  const logs = [];
  page.on('console', msg => logs.push({ type: 'console', text: msg.text() }));
  page.on('pageerror', err => logs.push({ type: 'pageerror', text: String(err) }));
  page.on('response', resp => {
    const status = resp.status(); const url = resp.url();
    if (status >= 400) logs.push({ type: 'response', url, status });
  });

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
    console.log('Page loaded');
    // Basic interactions
    await page.evaluate(() => {
      const t = document.getElementById('themeToggle'); if (t) t.click();
      const s = document.getElementById('searchInput'); if (s) { s.value = 'the'; s.dispatchEvent(new Event('input')); }
      const r = document.getElementById('randomBtn'); if (r) r.click();
    });
    await page.waitForTimeout(800);
  } catch (err) {
    logs.push({ type: 'error', text: String(err) });
  }

  console.log('--- LOGS ---');
  logs.forEach(l => console.log(JSON.stringify(l)));

  await browser.close();
  server.close();
  process.exit(0);
})();
