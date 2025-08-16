// scripts/fetch-substack.mjs
import sanitizeHtml from "sanitize-html";
import slugify from "slugify";
import fs from "fs/promises";
import path from "path";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const ORIGIN = process.env.PUBLIC_SUBSTACK_URL || "https://damii3.substack.com";
const ARCHIVE = `${ORIGIN}/archive?sort=new`;
const UA =
  process.env.FETCH_UA ||
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const DATA_DIR = path.join(process.cwd(), "src", "data");
const POSTS_JSON = path.join(DATA_DIR, "posts.json");

const sanitize = (html = "") =>
  sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img","figure","figcaption","iframe"]),
    allowedAttributes: {
      "*": ["id","class","style"],
      a: ["href","name","target","rel"],
      img: ["src","alt","title","loading","width","height","srcset","sizes"],
      iframe: ["src","width","height","allow","allowfullscreen","frameborder"]
    },
    allowedSchemes: ["http","https","data"],
    transformTags: {
      a: (tag, attrs) => ({ tagName: "a", attribs: { ...attrs, rel: "noopener", target: "_blank" } })
    }
  });

const firstImg = (html = "") => {
  const $ = cheerio.load(html);
  const src = $("img").first().attr("src");
  return src || null;
};

const toExcerpt = (html = "") =>
  cheerio.load(html)("body").text().replace(/\s+/g, " ").trim().slice(0, 200) +
  (cheerio.load(html)("body").text().length > 200 ? "…" : "");

const makeSlug = (title, isoDate) => {
  const base = slugify(title || "poem", { lower: true, strict: true });
  const d = (isoDate || "").slice(0, 10);
  return `${base}-${d}`;
};

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": ORIGIN + "/"
    },
    redirect: "follow"
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return await res.text();
}

async function getPostLinks(limit = 12) {
  const html = await fetchHtml(ARCHIVE);
  const $ = cheerio.load(html);
  const set = new Set();

  // Any links that look like posts (/p/slug)
  $('a[href*="/p/"]').each((_, a) => {
    const href = $(a).attr("href");
    if (!href) return;
    try {
      const abs = new URL(href, ORIGIN).href;
      set.add(abs);
    } catch {}
  });

  return Array.from(set).slice(0, limit);
}

async function scrapePost(url) {
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const title =
    $('meta[property="og:title"]').attr("content") ||
    $("h1").first().text().trim() ||
    "Untitled";

  const isoDate =
    $("time[datetime]").attr("datetime") ||
    $('meta[property="article:published_time"]').attr("content") ||
    new Date().toISOString();

  const container =
    $("article").html() ||
    $(".available-content").html() ||
    $("main").html() ||
    $("body").html() ||
    "";

  const image =
    $('meta[property="og:image"]').attr("content") ||
    $("article img").first().attr("src") ||
    null;

  const contentHtml = sanitize(container);
  return {
    title,
    slug: makeSlug(title, isoDate),
    url,
    date: isoDate,
    image: image || firstImg(contentHtml),
    excerpt: toExcerpt(contentHtml),
    contentHtml
  };
}

async function main() {
  const links = await getPostLinks(12);
  const posts = [];
  for (const link of links) {
    try {
      posts.push(await scrapePost(link));
    } catch (e) {
      console.warn("Failed post:", link, e.message);
    }
  }

  await fs.mkdir(DATA_DIR, { recursive: true });
  if (posts.length) {
    await fs.writeFile(POSTS_JSON, JSON.stringify(posts, null, 2));
    console.log(`Saved ${posts.length} posts to src/data/posts.json`);
  } else {
    // Keep existing if present; else create empty
    try {
      await fs.access(POSTS_JSON);
      console.log("No posts scraped; keeping existing posts.json");
    } catch {
      await fs.writeFile(POSTS_JSON, "[]");
      console.log("No posts scraped; wrote empty posts.json");
    }
  }
}

main().catch(async (e) => {
  console.error("fetch-substack failed:", e.message);
  try {
    await fs.access(POSTS_JSON);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(POSTS_JSON, "[]");
  }
});
