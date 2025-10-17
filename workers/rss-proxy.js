// Cloudflare worker: compact RSS/Atom -> JSON proxy with SSRF checks + caching

import { parseFeed, safeFeedUrl } from '../lib/feed-parser.mjs';

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });
    try {
      const url = new URL(request.url);
      const feed = url.searchParams.get('rss_url');
      const count = Math.min(Math.max(Number(url.searchParams.get('count') || 50), 1), 100);
      if (!feed) return jsonResponse({ status: 'error', error: 'Missing rss_url param' }, 400);

      const safe = safeFeedUrl(feed, env);
      if (!safe.ok) return jsonResponse({ status: 'error', error: `Disallowed feed URL (${safe.reason})` }, 400);

      const cache = caches.default;
      const key = new Request(`${safe.url.href}::count=${count}`);
      const cached = await cache.match(key);
      if (cached) return withCors(cached);

      // simple retry for flaky upstreams
      let upstream, xml;
      for (let attempt = 0; attempt < 3; attempt++) {
        upstream = await fetch(safe.url.href, { headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9,*/*;q=0.8' } });
        if (upstream && upstream.ok) { xml = await upstream.text(); break; }
        await new Promise(r => setTimeout(r, 250 * (attempt + 1)));
      }
      if (!upstream || !upstream.ok) return jsonResponse({ status: 'error', error: 'Upstream error', code: upstream ? upstream.status : 0 }, 502);
      const head = xml.trim().slice(0, 50).toLowerCase();
      if (head.startsWith('<!doctype html') || head.startsWith('<html')) return jsonResponse({ status: 'error', error: 'Upstream returned HTML' }, 502);

  const items = parseFeed(String(xml), safe.url.href).slice(0, count);
  const cacheControl = 'public, max-age=300, stale-while-revalidate=600';
  const res = jsonResponse({ status: 'ok', items, count: items.length, source: safe.url.href }, 200, { 'cache-control': cacheControl });
      ctx.waitUntil(cache.put(key, res.clone()));
      return res;
    } catch (err) {
      return jsonResponse({ status: 'error', error: String(err) }, 500);
    }
  }
};

/* --- helpers --- */
function jsonResponse(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', ...extra } });
}
function corsHeaders() { return { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': 'content-type' }; }
function withCors(res) { const r = res.clone(); const h = new Headers(r.headers); Object.entries(corsHeaders()).forEach(([k, v]) => h.set(k, v)); return new Response(r.body, { status: r.status, headers: h }); }


