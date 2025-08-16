import Parser from "rss-parser";
import sanitizeHtml from "sanitize-html";
import slugify from "slugify";
import fs from "fs/promises";
import path from "path";
import fetch from "node-fetch";

const FEED = process.env.SUBSTACK_FEED || "https://YOUR_SUBSTACK.substack.com/feed";
const UA =
  process.env.FETCH_UA ||
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const parser = new Parser({ timeout: 20000 });

function firstImg(html = "") {
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

function toExcerpt(html = "") {
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return text.length > 220 ? text.slice(0, 200).trim() + "…" : text;
}

function sanitize(html = "") {
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img","figure","figcaption","iframe"]),
    allowedAttributes: {
      "*": ["id","class","style"],
      "a": ["href","name","target","rel"],
      "img": ["src","alt","title","loading","width","height","srcset","sizes"],
      "iframe": ["src","width","height","allow","allowfullscreen","frameborder"]
    },
    allowedSchemes: ["http", "https", "data"],
    transformTags: {
      "a": (tagName, attribs) => ({ tagName, attribs: { ...attribs, rel: "noopener", target: "_blank" } })
    }
  });
}

function makeSlug(title, isoDate) {
  const base = slugify(title || "poem", { lower: true, strict: true });
  const d = (isoDate || "").slice(0, 10); // YYYY-MM-DD
  return `${base}-${d}`;
}

async function fetchXml(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept": "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": url.replace(/\/feed$/, "/"),
      "Connection": "keep-alive"
    },
    redirect: "follow"
  });
  if (!res.ok) {
    // optional retry on http (rarely helps, but harmless)
    if (url.startsWith("https://")) {
      const res2 = await fetch(url.replace("https://", "http://"), {
        headers: { "User-Agent": UA, "Accept": "application/rss+xml, application/xml;q=0.9, */*;q=0.8" },
        redirect: "follow"
      });
      if (res2.ok) return await res2.text();
    }
    throw new Error(`Status code ${res.status}`);
  }
  return await res.text();
}

async function main() {
  console.log(`Fetching feed: ${FEED}`);
  const xml = await fetchXml(FEED);
  const feed = await parser.parseString(xml);

  const posts = (feed.items || []).map((it) => {
    const html = it["content:encoded"] || it.content || "";
    const date = it.isoDate || it.pubDate || new Date().toISOString();
    const slug = makeSlug(it.title, it.isoDate || it.pubDate);
    return {
      title: it.title || "Untitled",
      slug,
      url: it.link,
      date,
      image: firstImg(html),
      excerpt: toExcerpt(html),
      contentHtml: sanitize(html)
    };
  });

  const outDir = path.join(process.cwd(), "src", "data");
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, "posts.json"), JSON.stringify(posts, null, 2));
  console.log(`Saved ${posts.length} posts to src/data/posts.json`);
}

main().catch((e) => {
  console.error("Failed to fetch Substack feed:", e.message);
  process.exitCode = 1;
});
