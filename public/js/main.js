export default {
  async fetch(request, env, ctx) {
    const { method } = request;
    if (method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
    if (method !== "GET" && method !== "HEAD") {
      return json({ status: "error", error: "Method Not Allowed" }, 405);
    }

    const url = new URL(request.url);
    const feed = url.searchParams.get("rss_url");
    const countParam = parseInt(url.searchParams.get("count") || "0", 10);
    const count = Number.isFinite(countParam) ? Math.min(Math.max(countParam, 1), 100) : 50;

    if (!feed) return json({ status: "error", error: "Missing rss_url param" }, 400);

    const safe = safeFeedUrl(feed, env);
    if (!safe.ok) return json({ status: "error", error: `Disallowed feed URL (${safe.reason})` }, 400);

    // Cache key should include the normalized feed + count
    const keyUrl = new URL(request.url);
    keyUrl.searchParams.set("rss_url", safe.url.href);
    keyUrl.searchParams.set("count", String(count));
    const cache = caches.default;
    const cacheKey = new Request(keyUrl.toString(), request);
    const cached = await cache.match(cacheKey);
    if (cached) return withCors(cached);

    try {
      const upstream = await fetch(safe.url.href, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari",
          "Accept":
            "application/rss+xml, application/atom+xml, application/xml;q=0.9,*/*;q=0.8",
        },
        // You can also tune Cloudflare caching if you want:
        // cf: { cacheTtl: 300, cacheEverything: false },
      });
      if (!upstream.ok) {
        return json(
          { status: "error", error: "Upstream error", code: upstream.status },
          502
        );
      }

      const xml = await upstream.text();
      const items = parseFeed(xml).slice(0, count);

      const res = new Response(
        JSON.stringify({
          status: "ok",
          items,
          count: items.length,
          source: safe.url.href,
        }),
        {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "public, max-age=600",
            ...corsHeaders(),
          },
        }
      );
      ctx.waitUntil(cache.put(cacheKey, res.clone()));
      return res;
    } catch (err) {
      return json({ status: "error", error: String(err) }, 500);
    }
  },
};

/* ---------- helpers ---------- */

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}
function withCors(res) {
  const hdrs = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders())) hdrs.set(k, v);
  return new Response(res.body, { status: res.status, headers: hdrs });
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders() },
  });
}

/**
 * Guard against SSRF:
 * - Only http(s)
 * - Block localhost/loopback/link-local/private ranges
 * - Optional allow-list via env.ALLOW_HOSTS: "substack.com,example.org"
 */
function safeFeedUrl(input, env) {
  try {
    const u = new URL(input);
    const proto = u.protocol.toLowerCase();
    if (proto !== "http:" && proto !== "https:") return { ok: false, reason: "protocol" };

    const host = u.hostname.toLowerCase();

    // Optional allow-list
    const allowed = (env?.ALLOW_HOSTS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (allowed.length) {
      const ok = allowed.some((h) => host === h || host.endsWith("." + h));
      if (!ok) return { ok: false, reason: "host not allowed" };
    }

    // Block obvious private/metadata/loopback targets
    if (isPrivateHost(host)) return { ok: false, reason: "private host" };

    return { ok: true, url: u };
  } catch {
    return { ok: false, reason: "bad url" };
  }
}

function isPrivateHost(host) {
  // Block hostnames commonly used for local access
  const blockedNames = new Set([
    "localhost",
    "localhost.localdomain",
    "metadata.google.internal",
  ]);
  if (blockedNames.has(host)) return true;

  // IPv4 literal?
  const ipv4 = host.match(
    /^(?<a>\d{1,3})\.(?<b>\d{1,3})\.(?<c>\d{1,3})\.(?<d>\d{1,3})$/
  );
  if (ipv4) {
    const a = ["a", "b", "c", "d"].map((k) => parseInt(ipv4.groups[k], 10));
    // 10/8, 172.16/12, 192.168/16
    if (a[0] === 10) return true;
    if (a[0] === 172 && a[1] >= 16 && a[1] <= 31) return true;
    if (a[0] === 192 && a[1] === 168) return true;
    // Loopback 127/8
    if (a[0] === 127) return true;
    // Link-local 169.254/16 (includes cloud metadata 169.254.169.254)
    if (a[0] === 169 && a[1] === 254) return true;
    // CGNAT 100.64/10
    if (a[0] === 100 && a[1] >= 64 && a[1] <= 127) return true;
    // 0.0.0.0
    if (a.every((x) => x === 0)) return true;
  }

  // IPv6 loopback or local/ULA ranges
  if (host === "::1") return true;
  if (host.startsWith("fe80:")) return true; // link-local
  // fc00::/7 Unique local addresses
  if (host.startsWith("fc") || host.startsWith("fd")) return true;

  return false;
}

/* Minimal, dependency-free parser for RSS 2.0 and Atom 1.0 */
function parseFeed(xml) {
  // Prefer RSS <item>, else Atom <entry>
  const rssItems = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];
  if (rssItems.length) {
    return rssItems.map((m) => parseRssItem(m[1]));
  }
  const atomEntries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)];
  if (atomEntries.length) {
    return atomEntries.map((m) => parseAtomEntry(m[1]));
  }
  return [];
}

function parseRssItem(block) {
  const title =
    cdata(block, "title") ?? tag(block, "title") ?? "";
  const link =
    tag(block, "link") ??
    attr(block, "link", "href") ?? // rare
    (tag(block, "guid") && /ispermalink=\"?true\"?/i.test(block)) ? tag(block, "guid") : "" ;
  const pubDate =
    tag(block, "pubDate") ??
    tagNS(block, "dc:date") ??
    "";
  const content =
    cdata(block, "content:encoded") ??
    cdata(block, "description") ??
    tag(block, "description") ??
    "";
  return { title: title.trim(), link: safeTrim(link), pubDate: pubDate.trim(), content };
}

function parseAtomEntry(block) {
  const title = cdata(block, "title") ?? tag(block, "title") ?? "";
  // Prefer rel="alternate"
  const alt = block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["'][^>]*>/i);
  const any = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i);
  const link = alt?.[1] || any?.[1] || tag(block, "id") || "";
  const pubDate = tag(block, "updated") || tag(block, "published") || "";
  const content =
    cdata(block, "content") ??
    tag(block, "content") ??
    cdata(block, "summary") ??
    tag(block, "summary") ??
    "";
  return { title: title.trim(), link: safeTrim(link), pubDate: pubDate.trim(), content };
}

/* --- tiny regex helpers --- */
function cdata(str, name) {
  const re = new RegExp(`<${escapeTag(name)}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${escapeTag(name)}>`, "i");
  const m = str.match(re);
  return m ? m[1] : null;
}
function tag(str, name) {
  const re = new RegExp(`<${escapeTag(name)}>([\\s\\S]*?)<\\/${escapeTag(name)}>`, "i");
  const m = str.match(re);
  return m ? m[1] : null;
}
function tagNS(str, qname) {
  // e.g., dc:date
  return tag(str, qname);
}
function attr(str, tagName, attrName) {
  const re = new RegExp(`<${escapeTag(tagName)}[^>]*\\b${attrName}=[\"']([^\"']+)[\"'][^>]*>`, "i");
  const m = str.match(re);
  return m ? m[1] : null;
}
function escapeTag(n) {
  return n.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}
function safeTrim(s) {
  return (s || "").trim().replace(/\\s+/g, " ");
}

document.addEventListener('DOMContentLoaded', () => {
  // Theme toggle (persists in localStorage)
  const themeToggle = document.getElementById('theme-toggle');
  const root = document.documentElement;
  const stored =
    localStorage.getItem('theme') ||
    (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light');
  if (stored === 'dark') document.documentElement.setAttribute('data-theme', 'dark');

  function setTheme(t) {
    if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('theme', t);
  }

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      setTheme(cur === 'dark' ? 'light' : 'dark');
    });
  }

  // Random poem button
  const rndBtn = document.getElementById('random-poem-btn');
  if (rndBtn) {
    rndBtn.addEventListener('click', () => {
      const posts = Array.from(document.querySelectorAll('.posts-grid .card'));
      if (!posts.length) return;
      const idx = Math.floor(Math.random() * posts.length);
      const el = posts[idx];
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('highlight');
      setTimeout(() => el.classList.remove('highlight'), 2200);
    });
  }

  // Accessible focus for cards when clicked/read
  document.body.addEventListener('click', (e) => {
    const c = e.target.closest('.card');
    if (c) c.setAttribute('tabindex', '-1'), c.focus();
  });

  // Simple progressive reveal for cards if JS renders content
  const cards = document.querySelectorAll('.card');
  cards.forEach((card, i) => {
    card.style.animationDelay = i * 70 + 'ms';
  });

  // Search filtering (client-side)
  const search = document.getElementById('search');
  if (search) {
    search.addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      const items = document.querySelectorAll('.posts-grid .card');
      items.forEach((it) => {
        const text = it.textContent.toLowerCase();
        it.style.display = !q || text.includes(q) ? '' : 'none';
      });
    });
  }
});
