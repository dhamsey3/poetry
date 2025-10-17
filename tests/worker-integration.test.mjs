import assert from 'assert';
import workerModule from '../workers/rss-proxy.js';

// Mock environment and bindings
const env = { ALLOW_HOSTS: '' };
const ctx = { waitUntil: () => {} };

// Minimal fake cache implementation
const stored = new Map();
global.caches = { default: { match: async (req) => stored.get(req.url) || null, put: async (req, res) => { stored.set(req.url, res); } } };

// mock fetch to return a small RSS
global.fetch = async (url, opts) => {
  return { ok: true, text: async () => `<?xml version="1.0"?><rss><channel><item><title>X</title><link>https://ex/1</link><description>Hi</description></item></channel></rss>` };
};

const makeReq = (u) => new Request(u);

(async () => {
  const res = await workerModule.fetch(makeReq('https://example.com/?rss_url=https://ex.com/feed&count=5'), env, ctx);
  const body = await res.text();
  const parsed = JSON.parse(body);
  assert(parsed.status === 'ok' && Array.isArray(parsed.items) && parsed.items.length === 1, 'worker returned items');
  console.log('worker-integration test passed');
})();
