// Small RSS/Atom parsing utilities (ESM) reused by worker and tests
export function parseFeed(xml, base) {
  if (!xml) return [];
  const items = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(m => parseRssItem(m[1]));
  if (items.length) return items;
  return [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map(m => parseAtomEntry(m[1]));
}

export function parseRssItem(block) {
  const title = pick(cdata(block, /<title>([\s\S]*?)<\/title>/i), tag(block, 'title'));
  const linkRaw = pick(tag(block, 'link'), tag(block, 'guid'));
  const link = resolveLink(linkRaw);
  const content = pick(cdata(block, /<content:encoded>([\s\S]*?)<\/content:encoded>/i), cdata(block, /<description>([\s\S]*?)<\/description>/i), tag(block, 'description'));
  return { title: decodeEntities((title||'').trim()), link: (link||'').trim(), content: decodeEntities((content||'').trim()) };
}

export function parseAtomEntry(block) {
  const title = pick(cdata(block, /<title>([\s\S]*?)<\/title>/i), tag(block, 'title'));
  const alt = block.match(/<link[^>]*href=['"]([^'"]+)['"][^>]*>/i);
  const linkRaw = (alt && alt[1]) || tag(block, 'id') || '';
  const link = resolveLink(linkRaw);
  const content = pick(cdata(block, /<content>([\s\S]*?)<\/content>/i), tag(block, 'summary'));
  return { title: decodeEntities((title||'').trim()), link: (link||'').trim(), content: decodeEntities((content||'').trim()) };
}

export function cdata(s, re) { const m = re.exec(s); if (!m) return ''; const raw = m[1]; const cd = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(raw); return cd ? cd[1].trim() : raw.trim(); }
export function tag(s, name) { const re = new RegExp(`<${escapeTag(name)}[^>]*>([\s\S]*?)<\/${escapeTag(name)}>`, 'i'); const m = s.match(re); return m ? m[1] : ''; }
export function pick(...vals) { for (const v of vals) if (v && String(v).trim()) return String(v); return ''; }
export function escapeTag(n) { return String(n).replace(/[-\/^$*+?.()|[\]{}]/g, '\\$&'); }

function decodeEntities(str) {
  if (!str) return '';
  return str.replace(/&(#?\w+);/g, (m, n) => {
    if (n[0] === '#') {
      const code = n[1] === 'x' || n[1] === 'X' ? parseInt(n.slice(2), 16) : parseInt(n.slice(1), 10);
      return String.fromCharCode(isNaN(code) ? 63 : code);
    }
    const map = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    return map[n] || m;
  });
}

function resolveLink(href, base) {
  if (!href) return '';
  try { return new URL(href, base || undefined).href; } catch (e) { return href; }
}

export function safeFeedUrl(input, env) {
  try {
    const u = new URL(input);
    if (!['http:', 'https:'].includes(u.protocol)) return { ok: false, reason: 'protocol' };
    const host = u.hostname.toLowerCase();
    const allowed = (env?.ALLOW_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (allowed.length && !allowed.some(h => host === h || host.endsWith('.' + h))) return { ok: false, reason: 'host not allowed' };
    if (isPrivateHost(host)) return { ok: false, reason: 'private host' };
    return { ok: true, url: u };
  } catch (e) { return { ok: false, reason: 'bad url' }; }
}

export function isPrivateHost(host) {
  if (!host) return true;
  if (['localhost','localhost.localdomain','metadata.google.internal'].includes(host)) return true;
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = m.slice(1).map(n => parseInt(n, 10));
    if (a[0] === 10) return true;
    if (a[0] === 172 && a[1] >= 16 && a[1] <= 31) return true;
    if (a[0] === 192 && a[1] === 168) return true;
    if (a[0] === 127) return true;
    if (a[0] === 169 && a[1] === 254) return true;
    if (a[0] === 100 && a[1] >= 64 && a[1] <= 127) return true;
  }
  if (host === '::1') return true;
  if (host.startsWith('fe80:')) return true;
  if (host.startsWith('fc') || host.startsWith('fd')) return true;
  return false;
}
