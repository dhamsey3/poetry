// scripts/fetch-substack.mjs
import Parser from "rss-parser";
import sanitizeHtml from "sanitize-html";
import slugify from "slugify";
import fs from "fs/promises";
import path from "path";
import fetch from "node-fetch";
import { chromium } from "playwright";

const FEED = process.env.SUBSTACK_FEED || "https://YOUR_SUBSTACK.substack.com/feed";
const UA =
  process.env.FETCH_UA ||
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const parser = new Parser({ timeout: 20000 });

const DATA_DIR = path.join(process.cwd(), "src", "data");
const POSTS_JSON = path.join(DATA_DIR, "posts.json");

// ---------- helpers ----------
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
  if (!res.ok) throw new Error(`Status code ${res.status}`);
  return await res.text();
}

// ---------- main flows ----------
async function tryRss(feedUrl) {
  console.log(`Fetching feed (RSS): ${feedUrl}`);
  const xml = await fetchXml(feedUrl);
  const feed = await parser.parseString(xml);

  return (feed.items || []).map((it) => {
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
}

async function tryPlaywright(feedUrl, limit = 12) {
  const origin = feedUrl.replace(/\/feed$/, "");
  const archiveUrl = `${origin}/archive?sort=new`;

  console.log(`RSS failed; scraping via Playwright: ${archiveUrl}`);

  const browser = await chromium.launch();
  const context = await browser.newContext({ userAgent: UA });
  const page = await context.newPage();

  // Load archive and collect latest post URLs
  await page.goto(archiveUrl, { waitUntil: "domcontentloaded" });

  const postLinks = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    const urls = anchors
      .map(a => a.href)
      .filter(u => /\/p\//.test(u)) // typical Substack post path
      .filter((u, i, arr) => arr.indexOf(u) === i);
    return urls.slice(0, 30);
  });

  const posts = [];
  for (const url of postLinks.slice(0, limit)) {
    const p = await context.newPage();
    try {
      await p.goto(url, { waitUntil: "domcontentloaded" });

      const data = await p.evaluate(() => {
        const titleEl =
          document.querySelector('h1') ||
          document.querySelector('[data-post-title]') ||
          document.querySelector('meta[property="og:title"]');

        const title =
          (titleEl && titleEl.textContent?.trim()) ||
          document.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
          "Untitled";

        const timeEl = document.querySelector('time[datetime]');
        const isoDate =
          timeEl?.getAttribute('datetime') ||
          document.querySelector('meta[property="article:published_time"]')?.getAttribute('content') ||
          new Date().toISOString();

        const container =
          document.querySelector('article') ||
          document.querySelector('.available-content') ||
          document.querySelector('main') ||
          document.body;

        const html = container.innerHTML;

        const imgEl =
          document.querySelector('meta[property="og:image"]') ||
          document.querySelector('article img, .available-content img');

        const image =
          imgEl?.getAttribute('content') ||
          imgEl?.getAttribute('src') ||
          null;

        return { title, isoDate, html, image };
      });

      posts.push({
        title: data.title,
        slug: makeSlug(data.title, data.isoDate),
        url,
        date: data.isoDate,
        image: data.image,
        excerpt: toExcerpt(data.html),
        contentHtml: sanitize(data.html)
      });
    } catch (e) {
      console.warn(`Scrape failed for ${url}: ${e.message}`);
    } finally {
      await p.close();
    }
  }

  await browser.close();
  return posts;
}

async function writePosts(posts) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(POSTS_JSON, JSON.stringify(posts, null, 2));
  console.log(`Saved ${posts.length} posts to src/data/posts.json`);
}

async function main() {
  let posts = [];
  try {
    posts = await tryRss(FEED);
  } catch (e) {
    console.warn(`RSS fetch failed: ${e.message}`);
    try {
      posts = await tryPlaywright(FEED);
    } catch (e2) {
      console.warn(`Playwright scrape also failed: ${e2.message}`);
    }
  }

  if (!posts.length) {
    // If nothing new, keep existing file if present; else write empty
    try {
      await fs.access(POSTS_JSON);
      console.log("No new posts; keeping existing src/data/posts.json");
      return;
    } catch {
      console.warn("No existing posts.json; writing an empty list.");
      await writePosts([]);
      return;
    }
  }

  await writePosts(posts);
}

main().catch(async (e) => {
  console.error("Unexpected error in fetch-substack:", e);
  // Never hard-fail the build; ensure file exists
  try {
    await fs.access(POSTS_JSON);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(POSTS_JSON, "[]");
  }
  // exit 0 on purpose
});
