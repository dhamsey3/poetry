export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const feed = url.searchParams.get("rss_url");
    if (!feed) {
      return new Response(JSON.stringify({ status: "error", error: "Missing rss_url param" }), {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" }
      });
    }

    // cache at the edge for 10 minutes
    const cache = caches.default;
    const cacheKey = new Request(request.url, request);
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    try {
      const upstream = await fetch(feed, {
        headers: {
          "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari",
          "Accept": "application/rss+xml, application/atom+xml, application/xml;q=0.9,*/*;q=0.8",
        },
      });
      if (!upstream.ok) {
        return new Response(JSON.stringify({ status: "error", error: "Upstream error", code: upstream.status }), {
          status: 502,
          headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" }
        });
      }
      const xml = await upstream.text();

      // minimal XML → JSON (title/link/date/content)
      const items = [];
      const itemRe = /<item>([\s\S]*?)<\/item>/g;
      let m;
      while ((m = itemRe.exec(xml)) !== null) {
        const block = m[1];
        const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/s) || [,""])[1]
                   || (block.match(/<title>(.*?)<\/title>/s) || [,""])[1];
        const link = (block.match(/<link>(.*?)<\/link>/s) || [,""])[1];
        const pubDate = (block.match(/<pubDate>(.*?)<\/pubDate>/s) || [,""])[1];
        const content = (block.match(/<content:encoded><!\[CDATA\[(.*?)\]\]><\/content:encoded>/s) || [,""])[1]
                     || (block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/s) || [,""])[1]
                     || (block.match(/<description>(.*?)<\/description>/s) || [,""])[1];
        items.push({ title, link, pubDate, content });
      }

      const res = new Response(JSON.stringify({ status: "ok", items }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "public, max-age=600",
          "access-control-allow-origin": "*"
        }
      });
      ctx.waitUntil(cache.put(cacheKey, res.clone()));
      return res;
    } catch (err) {
      return new Response(JSON.stringify({ status: "error", error: String(err) }), {
        status: 500,
        headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" }
      });
    }
  }
}
