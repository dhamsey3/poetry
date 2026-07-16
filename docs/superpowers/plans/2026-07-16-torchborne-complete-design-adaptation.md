# Torchborne Complete Design Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Torchborne as a calm, complete poetry-reading experience while retaining its live RSS, search, sharing, ebook, sanitization, fallback, and static deployment behavior.

**Architecture:** Keep Python/Jinja responsible for build-time configuration and the semantic application shell. Move browser behavior from the oversized inline template script into a testable `public/static/app.js` module containing pure data/state helpers plus browser initialization. Replace the current decorative theme with Torchborne-owned CSS tokens and component styles in `public/static/styles.css`.

**Tech Stack:** Python 3, pytest, Jinja2, vanilla JavaScript, Node's built-in test runner, HTML5, CSS, Tailwind build pipeline, static hosting.

## Global Constraints

- Use live RSS data; do not import the prototype's hardcoded poems.
- Do not ship the prototype DC/React runtime, Postcode Lottery assets, tokens, logos, or fonts.
- Retain search, sharing, ebook, sanitization, load-more, build, and feed fallback behavior.
- Use URL hash state for reader and About navigation.
- Persist theme and reader font scale without failing when local storage is unavailable.
- Support a 320px viewport, keyboard operation, visible focus, WCAG AA contrast, and reduced motion.
- Preserve unrelated working-tree changes, especially `tests/test_prepare_featured.py`, `.history/tests/`, and `Shared link/`.

---

## File Structure

- Create `public/static/app.js`: post normalization, mood classification, filtering, related ranking, hash routing, UI state, rendering, dialog behavior, and browser initialization.
- Create `tests/test_app.js`: Node tests for exported pure JavaScript helpers.
- Create `tests/test_redesign_markup.py`: Jinja/build tests for the new semantic application shell and conditional ebook surface.
- Modify `index.html.j2`: replace the legacy page and inline application with the semantic header/home/reader/About/dialog shells and JSON configuration.
- Modify `public/static/styles.css`: replace the legacy decorative theme with the approved tokens, components, responsive rules, and accessibility states.
- Modify `fetch.py`: only add template inputs required by the new shell if tests demonstrate they are absent.
- Regenerate `public/static/tailwind-ui.css` and `dist/` through the existing production build; do not hand-edit generated files.

### Task 1: Pure post model and mood classification

**Files:**
- Create: `tests/test_app.js`
- Create: `public/static/app.js`

**Interfaces:**
- Produces: `slugify(value: string): string`, `classifyMood(post: object): 'shadow'|'dream'|'return'`, `normalizePost(raw: object, index: number): object`.
- Consumes: RSS fields already used by the legacy template (`title`, `link`, `description`, `content`, `pubDate`, `thumbnail`, `enclosure`, `categories`).

- [ ] **Step 1: Write failing classification tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyMood, normalizePost, slugify } = require('../public/static/app.js');

test('explicit mood category wins', () => {
  assert.equal(classifyMood({ categories: ['Dream'], title: 'Grief' }), 'dream');
});

test('keyword category is classified', () => {
  assert.equal(classifyMood({ categories: ['healing and homecoming'] }), 'return');
});

test('fallback mood is deterministic', () => {
  const post = { title: 'Untitled constellation', link: 'https://example.com/p/constellation' };
  assert.equal(classifyMood(post), classifyMood(post));
});

test('normalization creates a stable searchable model', () => {
  const post = normalizePost({ title: ' A Small Flame ', link: 'https://example.com/p/flame', categories: ['Faith'] }, 0);
  assert.equal(post.slug, 'flame');
  assert.equal(post.title, 'A Small Flame');
  assert.deepEqual(post.tags, ['Faith']);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/test_app.js`

Expected: FAIL because `public/static/app.js` or its exports do not exist.

- [ ] **Step 3: Implement the minimal pure model helpers**

Implement a UMD-style module wrapper that assigns helpers to `module.exports` in Node and to `window.TorchborneApp` in browsers. Normalize strings, categories, image candidates, dates, summaries, and stable slugs. Classification order is exact mood tag, category keyword, title/summary keyword, then a stable string hash modulo three.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --test tests/test_app.js`

Expected: all Task 1 tests PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add public/static/app.js tests/test_app.js
git commit -m "feat: add Torchborne post model"
```

### Task 2: Filtering, related ranking, sequence navigation, and hash routing

**Files:**
- Modify: `tests/test_app.js`
- Modify: `public/static/app.js`

**Interfaces:**
- Produces: `filterPosts(posts, criteria)`, `rankRelated(posts, current, limit)`, `getAdjacent(posts, slug)`, `parseHash(hash)`, `formatHash(route)`.
- Consumes: normalized post objects from Task 1.

- [ ] **Step 1: Add failing state-helper tests**

```js
test('search mood and tag filters combine', () => {
  const posts = [
    { title:'Night Door', summary:'grief', mood:'shadow', tags:['Memory'], searchText:'night door grief memory shadow' },
    { title:'Morning Hands', summary:'healing', mood:'return', tags:['Body'], searchText:'morning hands healing body return' }
  ];
  assert.deepEqual(filterPosts(posts, { query:'night', mood:'shadow', tag:'Memory' }).map(p => p.title), ['Night Door']);
});

test('related ranking prefers mood then shared tags', () => {
  const current = { slug:'a', mood:'dream', tags:['Faith'] };
  const posts = [current, {slug:'b',mood:'dream',tags:[]}, {slug:'c',mood:'return',tags:['Faith']}, {slug:'d',mood:'return',tags:[]}];
  assert.deepEqual(rankRelated(posts, current, 3).map(p => p.slug), ['b','c','d']);
});

test('hash route round trips reader and about state', () => {
  assert.deepEqual(parseHash(formatHash({ view:'reader', slug:'small-flame' })), { view:'reader', slug:'small-flame' });
  assert.deepEqual(parseHash('#about'), { view:'about' });
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/test_app.js`

Expected: FAIL because the new helpers are undefined.

- [ ] **Step 3: Implement minimal helpers**

Filtering must be case-insensitive and combine all active criteria. Related scoring gives mood matches higher weight than shared tags and preserves feed order for ties. Adjacent navigation wraps only when more than one result exists. Hash routes are `#poem/<encoded-slug>`, `#about`, or empty home.

- [ ] **Step 4: Run and verify GREEN**

Run: `node --test tests/test_app.js`

Expected: all JavaScript tests PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add public/static/app.js tests/test_app.js
git commit -m "feat: add poetry discovery state helpers"
```

### Task 3: Semantic application shell

**Files:**
- Create: `tests/test_redesign_markup.py`
- Modify: `index.html.j2`
- Modify: `fetch.py` only if required template data is missing.

**Interfaces:**
- Produces DOM hooks consumed by `app.js`: `appHeader`, `homeView`, `readerView`, `aboutView`, `searchInput`, `moodFilters`, `tagFilters`, `postsGrid`, `resultSummary`, `loadMore`, `subscribeDialog`, `initialPostsData`, and `appConfig`.
- Consumes Jinja inputs from `fetch.render_index()`.

- [ ] **Step 1: Write failing markup tests**

```python
from fetch import render_index

def test_redesign_shell_contains_semantic_views(tmp_path, monkeypatch):
    monkeypatch.setattr('fetch.DIST_DIR', tmp_path)
    render_index('Torchborne', 'https://example.com/feed', 'https://example.com', '')
    html = (tmp_path / 'index.html').read_text(encoding='utf-8')
    for hook in ('id="homeView"', 'id="readerView"', 'id="aboutView"', 'id="subscribeDialog"', 'id="initialPostsData"', 'src="./static/app.js'):
        assert hook in html
    assert 'support.js' not in html
    assert 'fortune-design-system' not in html

def test_ebook_surface_remains_conditional(tmp_path, monkeypatch):
    monkeypatch.setattr('fetch.DIST_DIR', tmp_path)
    monkeypatch.delenv('EBOOK_KINDLE_URL', raising=False)
    render_index('Torchborne', 'https://example.com/feed', 'https://example.com', '')
    assert 'id="ebookSpotlight"' not in (tmp_path / 'index.html').read_text(encoding='utf-8')
```

- [ ] **Step 2: Run and verify RED**

Run: `./.venv/bin/python -m pytest tests/test_redesign_markup.py -q`

Expected: FAIL because the new view hooks and application script do not exist.

- [ ] **Step 3: Replace the template shell**

Build the approved header, hero/search/filter home view, ebook conditional, results region, reader shell, About view, footer, subscribe dialog, JSON post data, and JSON/string configuration. Keep the no-JavaScript message and direct Substack links. Remove the legacy inline application script and decorative surfaces.

- [ ] **Step 4: Run and verify GREEN**

Run: `./.venv/bin/python -m pytest tests/test_redesign_markup.py tests/test_fetch.py -q`

Expected: all selected tests PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add index.html.j2 fetch.py tests/test_redesign_markup.py
git commit -m "feat: add semantic Torchborne application shell"
```

### Task 4: Browser application behavior

**Files:**
- Modify: `tests/test_app.js`
- Modify: `public/static/app.js`

**Interfaces:**
- Produces browser initializer `init(document, window)` and complete home/reader/About/dialog behavior.
- Consumes DOM hooks from Task 3 and pure helpers from Tasks 1–2.

- [ ] **Step 1: Add failing tests for bounded reader scale and safe storage**

```js
test('reader scale is clamped', () => {
  assert.equal(clampReaderScale(2), 1.4);
  assert.equal(clampReaderScale(0.2), 0.85);
});

test('storage helpers tolerate denied storage', () => {
  const denied = { getItem(){ throw new Error('denied'); }, setItem(){ throw new Error('denied'); } };
  assert.equal(readPreference(denied, 'theme', 'light'), 'light');
  assert.doesNotThrow(() => writePreference(denied, 'theme', 'dark'));
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/test_app.js`

Expected: FAIL because preference helpers are undefined.

- [ ] **Step 3: Implement state and rendering**

Implement one state object for view, selected slug, query, mood, tag, visible limit, theme, reader scale, and dialog state. Wire search, mood/tag controls, clear filters, load more, cards, sharing, theme persistence, hash change/popstate, reader rendering, related/adjacent navigation, progress, About navigation, and invalid-route recovery. Sanitize feed HTML using the existing trusted sanitization strategy before insertion.

- [ ] **Step 4: Implement accessible dialog and keyboard behavior**

Subscribe triggers remain real links for no-JavaScript fallback and are progressively enhanced. On open, store the trigger, show the native dialog or accessible fallback, focus the first dialog control, and mark background inert where supported. Close on button, backdrop, or Escape and restore trigger focus. Reader Escape returns home; arrows navigate only outside inputs, textareas, selects, and contenteditable regions.

- [ ] **Step 5: Run and verify GREEN**

Run: `node --test tests/test_app.js && ./.venv/bin/python -m pytest -q`

Expected: all JavaScript and Python tests PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add public/static/app.js tests/test_app.js
git commit -m "feat: implement complete Torchborne interactions"
```

### Task 5: Torchborne visual system and responsive layout

**Files:**
- Modify: `tests/test_redesign_markup.py`
- Modify: `public/static/styles.css`

**Interfaces:**
- Consumes semantic class names and states from Tasks 3–4.
- Produces light/dark tokens, component styling, responsive behavior, focus states, and reduced-motion overrides.

- [ ] **Step 1: Add failing stylesheet contract test**

```python
def test_stylesheet_contains_accessible_responsive_contract():
    css = Path('public/static/styles.css').read_text(encoding='utf-8')
    for rule in (':focus-visible', 'prefers-reduced-motion', '[data-theme="dark"]', '.reader-view', '.subscribe-dialog', '@media (max-width: 640px)'):
        assert rule in css
    assert '.particles' not in css
    assert '.floating-shapes' not in css
```

- [ ] **Step 2: Run and verify RED**

Run: `./.venv/bin/python -m pytest tests/test_redesign_markup.py::test_stylesheet_contains_accessible_responsive_contract -q`

Expected: FAIL because the legacy stylesheet still includes decorative systems and lacks the new component contract.

- [ ] **Step 3: Replace the legacy stylesheet**

Define warm paper/charcoal themes, ember identity accent, green Subscribe action, semantic spacing and type tokens, compact sticky header, text-first hero, controls, cards, ebook spotlight, status states, full-page reader, About layout, footer, and dialog. Use fixed breakpoint type sizes, one-to-three-column grids, 44px mobile targets, bounded reading measure, visible focus, stable image ratios, long-text wrapping, and no horizontal overflow.

- [ ] **Step 4: Add reduced-motion and print behavior**

Disable nonessential animation and smooth scrolling under `prefers-reduced-motion`. Print only the open poem title, metadata, and body when the reader is active.

- [ ] **Step 5: Run and verify GREEN**

Run: `./.venv/bin/python -m pytest tests/test_redesign_markup.py -q`

Expected: all stylesheet and markup tests PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add public/static/styles.css tests/test_redesign_markup.py
git commit -m "feat: apply calm Torchborne visual system"
```

### Task 6: Regression, build, and visual QA

**Files:**
- Modify only files implicated by failing tests or visual defects.
- Generated: `public/static/tailwind-ui.css`, `dist/index.html`, `dist/static/styles.css`, `dist/static/app.js`.

**Interfaces:**
- Consumes the complete implementation.
- Produces verified static build output.

- [ ] **Step 1: Run the complete automated suite**

Run: `node --test tests/test_app.js`

Expected: PASS with no warnings.

Run: `./.venv/bin/python -m pytest -q`

Expected: PASS. If the pre-existing modified `tests/test_prepare_featured.py` collection error remains, report it separately and do not overwrite that user-owned change; run all unaffected tests explicitly.

- [ ] **Step 2: Run the production build**

Run: `npm run build`

Expected: CSS compiles and `dist/index.html`, `dist/static/styles.css`, and `dist/static/app.js` are produced successfully.

- [ ] **Step 3: Serve and inspect desktop/mobile states**

Run: `npm run serve`

Inspect home, filtered/empty results, reader, About, Subscribe, ebook-present/absent, light/dark, 320px, representative phone width, and desktop. Verify no clipping, overlap, broken images, or horizontal scrolling.

- [ ] **Step 4: Inspect keyboard and URL behavior**

Verify skip link, tab order, focus visibility, Subscribe focus restoration, Escape behavior, reader arrow navigation, hash refresh, back/forward navigation, and filter restoration.

- [ ] **Step 5: Fix each observed defect test-first**

For every functional defect, add a failing automated test, confirm RED, implement the minimal correction, and confirm GREEN. For purely visual defects, record the viewport/state, change only the relevant CSS rule, and repeat the screenshot inspection.

- [ ] **Step 6: Run final verification**

Run: `node --test tests/test_app.js && ./.venv/bin/python -m pytest -q && npm run build && git diff --check`

Expected: all tests and build pass; diff check is clean. Any pre-existing user-owned test syntax failure is explicitly excluded and documented with evidence.

- [ ] **Step 7: Commit verified adaptation**

```bash
git add index.html.j2 public/static/app.js public/static/styles.css public/static/tailwind-ui.css tests/test_app.js tests/test_redesign_markup.py fetch.py dist
git commit -m "feat: complete Torchborne design adaptation"
```
