export default {
  async fetch(request, env, ctx) {
    const { method } = request;
    if (method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });
    if (method !== 'GET' && method !== 'HEAD') return json({ status: 'error', error: 'Method Not Allowed' }, 405);

    const url = new URL(request.url);
    const feed = url.searchParams.get('rss_url');
    const countParam = parseInt(url.searchParams.get('count') || '0', 10);
    const count = Number.isFinite(countParam) ? Math.min(Math.max(countParam, 1), 100) : 50;

    if (!feed) return json({ status: 'error', error: 'Missing rss_url param' }, 400);
    const safe = safeFeedUrl(feed, env);
    if (!safe.ok) return json({ status: 'error', error: `Disallowed feed URL (${safe.reason})` }, 400);

    const keyUrl = new URL(request.url);
    keyUrl.searchParams.set('rss_url', safe.url.href);
    keyUrl.searchParams.set('count', String(count));
    const cache = caches.default;
    const cacheKey = new Request(keyUrl.toString(), request);
    const cached = await cache.match(cacheKey);
    if (cached) return withCors(cached);

    try {
      const upstream = await fetch(safe.url.href, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9,*/*;q=0.8',
        },
      });
      if (!upstream.ok) return json({ status: 'error', error: 'Upstream error', code: upstream.status }, 502);
      const xml = await upstream.text();
      const items = parseFeed(xml).slice(0, count);
      const res = new Response(JSON.stringify({ status: 'ok', items, count: items.length, source: safe.url.href }), {
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=600', ...corsHeaders() },
      });
      ctx.waitUntil(cache.put(cacheKey, res.clone()));
      return res;
    } catch (err) {
      return json({ status: 'error', error: String(err) }, 500);
    }
  },
};

/* ---------- helpers ---------- */

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
}
function withCors(res) {
  // clone to avoid locked/body reuse issues
  const r = res.clone();
  const hdrs = new Headers(r.headers);
  for (const [k, v] of Object.entries(corsHeaders())) hdrs.set(k, v);
  return new Response(r.body, { status: r.status, headers: hdrs });
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders() },
  });
}

function safeFeedUrl(input, env) {
  try {
    const u = new URL(input);
    const proto = u.protocol.toLowerCase();
    if (proto !== 'http:' && proto !== 'https:') return { ok: false, reason: 'protocol' };

    const host = u.hostname.toLowerCase();

    const allowed = (env?.ALLOW_HOSTS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (allowed.length) {
      const ok = allowed.some((h) => host === h || host.endsWith('.' + h));
      if (!ok) return { ok: false, reason: 'host not allowed' };
    }

    if (isPrivateHost(host)) return { ok: false, reason: 'private host' };

    return { ok: true, url: u };
  } catch {
    return { ok: false, reason: 'bad url' };
  }
}

function isPrivateHost(host) {
  const blockedNames = new Set(['localhost', 'localhost.localdomain', 'metadata.google.internal']);
  if (blockedNames.has(host)) return true;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a0 = parseInt(ipv4[1], 10);
    const a1 = parseInt(ipv4[2], 10);
    if (a0 === 10) return true;
    if (a0 === 172 && a1 >= 16 && a1 <= 31) return true;
    if (a0 === 192 && a1 === 168) return true;
    if (a0 === 127) return true;
    if (a0 === 169 && a1 === 254) return true;
    if (a0 === 100 && a1 >= 64 && a1 <= 127) return true;
    if (a0 === 0 && a1 === 0) return true;
  }

  if (host === '::1') return true;
  if (host.startsWith('fe80:')) return true;
  if (host.startsWith('fc') || host.startsWith('fd')) return true;

  return false;
}

/* Minimal, dependency-free parser for RSS 2.0 and Atom 1.0 */
function parseFeed(xml) {
  if (!xml || typeof xml !== 'string') return [];
  const rssItems = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)];
  if (rssItems.length) {
    return rssItems.map((m) => parseRssItem(m[1]));
  }
  const atomEntries = [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)];
  if (atomEntries.length) {
    return atomEntries.map((m) => parseAtomEntry(m[1]));
  }
  return [];
}

function parseRssItem(block) {
  const title = cdata(block, 'title') ?? tag(block, 'title') ?? '';
  const linkText = tag(block, 'link');
  const linkHref = attr(block, 'link', 'href');
  const guid = tag(block, 'guid') ?? '';
  const guidAttrIsPermalink = attr(block, 'guid', 'isPerMaLink') || attr(block, 'guid', 'ispermalink') || attr(block, 'guid', 'isPermaLink');
  const guidIsPermalink = (typeof guidAttrIsPermalink === 'string' && /^true$/i.test(guidAttrIsPermalink)) ||
    /isPermaLink\s*=\s*["']?true["']?/i.test(block) || /ispermalink\s*=\s*["']?true["']?/i.test(block);
  const link = (linkText && safeTrim(linkText)) || linkHref || (guid && guidIsPermalink ? safeTrim(guid) : '');
  const pubDate = tag(block, 'pubDate') ?? tagNS(block, 'dc:date') ?? '';
  const content =
    cdata(block, 'content:encoded') ??
    cdata(block, 'description') ??
    tag(block, 'description') ??
    '';
  return { title: title.trim(), link: safeTrim(link), pubDate: pubDate.trim(), content };
}

function parseAtomEntry(block) {
  const title = cdata(block, 'title') ?? tag(block, 'title') ?? '';
  const alt = block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["'][^>]*>/i);
  const any = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i);
  const link = alt?.[1] || any?.[1] || tag(block, 'id') || '';
  const pubDate = tag(block, 'updated') || tag(block, 'published') || '';
  const content =
    cdata(block, 'content') ??
    tag(block, 'content') ??
    cdata(block, 'summary') ??
    tag(block, 'summary') ??
    '';
  return { title: title.trim(), link: safeTrim(link), pubDate: pubDate.trim(), content };
}

/* --- tiny regex helpers --- */
function cdata(str, name) {
  const re = new RegExp(`<${escapeTag(name)}>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${escapeTag(name)}>`, 'i');
  const m = str.match(re);
  return m ? m[1] : null;
}
function tag(str, name) {
  const re = new RegExp(`<${escapeTag(name)}[^>]*>([\\s\\S]*?)<\\/${escapeTag(name)}>`, 'i');
  const m = str.match(re);
  return m ? m[1] : null;
}
function tagNS(str, qname) {
  return tag(str, qname);
}
function attr(str, tagName, attrName) {
  const re = new RegExp(`<${escapeTag(tagName)}[^>]*\\b${attrName}\\s*=\\s*["']([^"']+)["'][^>]*>`, 'i');
  const m = str.match(re);
  return m ? m[1] : null;
}
function escapeTag(n) {
  return n.replace(/[-\\/\\^$*+?.()|[\\]{}]/g, '\\$&');
}
function safeTrim(s) {
  return (s || '').toString().trim().replace(/\\s+/g, ' ');
}