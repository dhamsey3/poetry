import assert from 'assert';
import { parseFeed } from '../lib/feed-parser.mjs';

const sampleRss = `<?xml version="1.0"?><rss><channel><item><title>Poem One</title><link>https://example.com/1</link><description><![CDATA[<p>Hello</p>]]></description></item></channel></rss>`;
const sampleAtom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Entry One</title><link href="https://example.com/e1"/></entry></feed>`;

const r = parseFeed(sampleRss);
assert(Array.isArray(r) && r.length === 1, 'RSS parsed');
assert(r[0].title === 'Poem One', 'RSS title');

const a = parseFeed(sampleAtom);
assert(Array.isArray(a) && a.length === 1, 'Atom parsed');
assert(a[0].link === 'https://example.com/e1', 'Atom link');

console.log('feed-parser tests passed');
