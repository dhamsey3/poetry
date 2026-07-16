const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyMood,
  clampReaderScale,
  filterPosts,
  formatHash,
  getAdjacent,
  normalizePost,
  parseHash,
  rankRelated,
  readPreference,
  resolveRoute,
  slugify,
  writePreference,
} = require('../public/static/app.js');

test('explicit mood category wins over text keywords', () => {
  assert.equal(classifyMood({ categories: ['Dream'], title: 'Grief' }), 'dream');
});

test('keyword category is classified', () => {
  assert.equal(classifyMood({ categories: ['healing and homecoming'] }), 'return');
});

test('fallback mood is deterministic', () => {
  const post = { title: 'Untitled constellation', link: 'https://example.com/p/constellation' };
  assert.equal(classifyMood(post), classifyMood(post));
});

test('slugify creates a readable stable identifier', () => {
  assert.equal(slugify('  A Small Flame!  '), 'a-small-flame');
});

test('normalization creates a stable searchable model', () => {
  const post = normalizePost({
    title: ' A Small Flame ',
    link: 'https://example.com/p/flame',
    categories: ['Faith'],
  }, 0);

  assert.equal(post.slug, 'flame');
  assert.equal(post.title, 'A Small Flame');
  assert.deepEqual(post.tags, ['Faith']);
  assert.match(post.searchText, /faith/i);
});

test('search mood and tag filters combine', () => {
  const posts = [
    { title: 'Night Door', summary: 'grief', mood: 'shadow', tags: ['Memory'], searchText: 'night door grief memory shadow' },
    { title: 'Morning Hands', summary: 'healing', mood: 'return', tags: ['Body'], searchText: 'morning hands healing body return' },
  ];

  assert.deepEqual(
    filterPosts(posts, { query: 'night', mood: 'shadow', tag: 'memory' }).map((post) => post.title),
    ['Night Door'],
  );
});

test('related ranking prefers matching mood then shared tags', () => {
  const current = { slug: 'a', mood: 'dream', tags: ['Faith'], sourceIndex: 0 };
  const posts = [
    current,
    { slug: 'b', mood: 'dream', tags: [], sourceIndex: 1 },
    { slug: 'c', mood: 'return', tags: ['Faith'], sourceIndex: 2 },
    { slug: 'd', mood: 'return', tags: [], sourceIndex: 3 },
  ];

  assert.deepEqual(rankRelated(posts, current, 3).map((post) => post.slug), ['b', 'c', 'd']);
});

test('adjacent navigation follows the filtered order', () => {
  const posts = [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }];
  assert.deepEqual(getAdjacent(posts, 'b'), { previous: posts[0], next: posts[2] });
});

test('hash route round trips reader and about state', () => {
  assert.deepEqual(parseHash(formatHash({ view: 'reader', slug: 'small flame' })), { view: 'reader', slug: 'small flame' });
  assert.deepEqual(parseHash('#about'), { view: 'about' });
  assert.deepEqual(parseHash(''), { view: 'home' });
});

test('reader scale is clamped to comfortable limits', () => {
  assert.equal(clampReaderScale(2), 1.4);
  assert.equal(clampReaderScale(0.2), 0.85);
  assert.equal(clampReaderScale(1.17), 1.17);
});

test('preference helpers tolerate denied storage', () => {
  const denied = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
  };

  assert.equal(readPreference(denied, 'theme', 'light'), 'light');
  assert.doesNotThrow(() => writePreference(denied, 'theme', 'dark'));
});

test('reader route waits for asynchronously loaded posts', () => {
  const route = { view: 'reader', slug: 'small-flame' };
  assert.deepEqual(resolveRoute(route, [], false), { status: 'pending', route });
  assert.deepEqual(resolveRoute(route, [{ slug: 'small-flame' }], true), { status: 'ready', route });
  assert.deepEqual(resolveRoute(route, [{ slug: 'other' }], true), { status: 'invalid', route: { view: 'home' } });
});
