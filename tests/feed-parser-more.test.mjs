import assert from 'assert';
import { parseFeed } from '../lib/feed-parser.mjs';

// content:encoded
const rssWithContentEncoded = `<?xml version="1.0"?><rss><channel><item><title>CE</title><link>https://ex/ce</link><content:encoded><![CDATA[<p>Encoded</p>]]></content:encoded></item></channel></rss>`;
const res1 = parseFeed(rssWithContentEncoded);
assert(Array.isArray(res1) && res1.length === 1 && /Encoded/.test(res1[0].content), 'content:encoded parsed');

// CDATA in title
const rssWithCdataTitle = `<?xml version="1.0"?><rss><channel><item><title><![CDATA[<strong>Hi</strong>]]></title><link>https://ex/1</link></item></channel></rss>`;
const res2 = parseFeed(rssWithCdataTitle);
assert(res2[0].title.includes('Hi'), 'CDATA title handled');

// malformed feed should return empty array
const malformed = `<html><body>No feed</body></html>`;
const res3 = parseFeed(malformed);
assert(Array.isArray(res3) && res3.length === 0, 'malformed returns empty');

console.log('feed-parser-more tests passed');
