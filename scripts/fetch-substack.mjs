import Parser from "rss-parser";
import sanitizeHtml from "sanitize-html";
import slugify from "slugify";
import fs from "fs/promises";
import path from "path";

const FEED = process.env.SUBSTACK_FEED || "https://damii3.substack.com/feed";

const parser = new Parser({
  timeout: 20000,
  headers: { "User-Agent": "github-pages-poetry-bot/1.0" }
});

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
    },
    // strip any script tags, inline events, etc. (defaults already do)
  });
}

function makeSlug(title, isoDate) {
  const base = slugify(title || "poem", { lower: true, strict: true });
  const d = (isoDate || "").slice(0, 10); // YYYY-MM-DD
  return `${base}-${d}`;
}

async function main() {
  console.log(`Fetching feed: ${FEED}`);
  const feed = await parser.parseURL(FEED);

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
