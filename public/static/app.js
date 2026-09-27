(function initTorchborneModule(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TorchborneApp = api;
})(typeof window !== 'undefined' ? window : null, function createTorchborneApp() {
  'use strict';

  const MOODS = ['shadow', 'dream', 'return'];
  const MOOD_KEYWORDS = {
    shadow: ['shadow', 'grief', 'dark', 'memory', 'loss', 'longing', 'silence', 'hidden', 'wound'],
    dream: ['dream', 'sleep', 'symbol', 'faith', 'spirit', 'prayer', 'wonder', 'vision', 'night'],
    return: ['return', 'healing', 'homecoming', 'home', 'body', 'tender', 'hope', 'restore', 'morning'],
  };

  function text(value) {
    return value == null ? '' : String(value).trim();
  }

  function stripHtml(value) {
    return text(value)
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#0?39;/gi, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  function slugify(value) {
    return text(value)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'poem';
  }

  function tagsOf(post) {
    const source = post && (post.categories || post.tags || post.category);
    const values = Array.isArray(source) ? source : source ? [source] : [];
    return [...new Set(values.map(text).filter(Boolean))];
  }

  function stableHash(value) {
    let hash = 2166136261;
    for (const char of text(value)) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function classifyMood(post) {
    const tags = tagsOf(post);
    const normalizedTags = tags.map((tag) => tag.toLowerCase());
    for (const mood of MOODS) {
      if (normalizedTags.includes(mood)) return mood;
    }
    const tagText = normalizedTags.join(' ');
    for (const mood of MOODS) {
      if (MOOD_KEYWORDS[mood].some((keyword) => tagText.includes(keyword))) return mood;
    }
    const bodyText = `${text(post && post.title)} ${stripHtml(post && (post.description || post.summary))}`.toLowerCase();
    for (const mood of MOODS) {
      if (MOOD_KEYWORDS[mood].some((keyword) => bodyText.includes(keyword))) return mood;
    }
    const identity = text(post && post.link) || text(post && post.title) || 'torchborne';
    return MOODS[stableHash(identity) % MOODS.length];
  }

  function slugFromLink(link) {
    try {
      const parts = new URL(link).pathname.split('/').filter(Boolean);
      return slugify(parts[parts.length - 1] || '');
    } catch (_) {
      return '';
    }
  }

  function imageOf(raw) {
    const enclosure = raw && raw.enclosure;
    return text(raw && (raw.thumbnail || raw.image || raw.image_url)) ||
      text(enclosure && (enclosure.link || enclosure.url));
  }

  const NAMED_ENTITIES = {
    nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', rsquo: '\u2019', lsquo: '\u2018',
    rdquo: '\u201d', ldquo: '\u201c', mdash: '\u2014', ndash: '\u2013', hellip: '\u2026',
  };

  function decodeEntities(value) {
    return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
      if (entity[0] === '#') {
        const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
      }
      const named = NAMED_ENTITIES[entity.toLowerCase()];
      return named == null ? match : named;
    });
  }

  function verseTextOf(html) {
    const match = /<pre[^>]*>([\s\S]*?)<\/pre>/i.exec(String(html || ''));
    return match ? decodeEntities(match[1].replace(/<[^>]+>/g, '')) : '';
  }

  // Splits verse text into stanzas; a line of only dashes/asterisks marks a section break.
  function parseVerse(value) {
    const blocks = [];
    let lines = [];
    const flush = () => { if (lines.length) blocks.push({ type: 'stanza', lines }); lines = []; };
    String(value || '').replace(/\r\n?/g, '\n').split('\n').forEach((raw) => {
      const line = raw.replace(/\s+$/, '');
      if (/^\s*([-*_]\s*){3,}$/.test(line)) {
        flush();
        if (blocks.length && blocks[blocks.length - 1].type !== 'break') blocks.push({ type: 'break' });
      } else if (!line.trim()) flush();
      else lines.push(line);
    });
    flush();
    while (blocks.length && blocks[blocks.length - 1].type === 'break') blocks.pop();
    return blocks;
  }

  function clip(value, limit) {
    const clean = text(value).replace(/\s+/g, ' ');
    if (clean.length <= limit) return clean;
    const cut = clean.slice(0, limit + 1);
    const space = cut.lastIndexOf(' ');
    return `${(space > limit * 0.6 ? cut.slice(0, space) : cut.slice(0, limit)).replace(/[\s,;:—–-]+$/, '')}…`;
  }

  function openingLine(verse, summary) {
    const stanza = parseVerse(verse).find((block) => block.type === 'stanza');
    if (!stanza) return clip(summary, 90);
    let line = '';
    for (const next of stanza.lines) {
      line = line ? `${line} / ${next.trim()}` : next.trim();
      if (line.length >= 45) break;
    }
    if (line.length > 90) return clip(line, 90);
    return /[.!?…”"]$/.test(line) ? line : `${line.replace(/[\s,;:—–-]+$/, '')}…`;
  }

  function romanize(value) {
    let number = Math.floor(Number(value));
    if (!Number.isFinite(number) || number <= 0 || number >= 4000) return String(value || '');
    const table = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let out = '';
    for (const [amount, numeral] of table) {
      while (number >= amount) { out += numeral; number -= amount; }
    }
    return out;
  }

  function pickFeatured(posts) {
    const list = posts || [];
    return list.find((post) => parseVerse(post.verse).some((block) => block.type === 'stanza')) || list[0] || null;
  }

  function normalizePost(raw, index) {
    const source = raw || {};
    const title = text(source.title) || 'Untitled poem';
    const link = text(source.link || source.url);
    const tags = tagsOf(source);
    const summary = stripHtml(source.description || source.summary || source.excerpt).slice(0, 320);
    const content = text(source.content || source.content_html || source.description);
    const slugBase = slugFromLink(link) || slugify(title);
    const slug = slugBase === 'poem' ? `poem-${Number(index || 0) + 1}` : slugBase;
    const mood = classifyMood({ ...source, title, description: summary, categories: tags });
    const verse = verseTextOf(content);
    return {
      ...source,
      title,
      link,
      slug,
      tags,
      mood,
      summary,
      content,
      verse,
      opening: openingLine(verse, summary),
      image: imageOf(source),
      date: text(source.pubDate || source.date || source.published_at),
      searchText: `${title} ${summary} ${tags.join(' ')} ${mood}`.toLowerCase(),
      sourceIndex: Number(index || 0),
    };
  }

  function filterPosts(posts, criteria) {
    const options = criteria || {};
    const query = text(options.query).toLowerCase();
    const mood = text(options.mood).toLowerCase();
    const tag = text(options.tag).toLowerCase();
    return (posts || []).filter((post) => {
      const matchesQuery = !query || text(post.searchText).toLowerCase().includes(query);
      const matchesMood = !mood || mood === 'all' || text(post.mood).toLowerCase() === mood;
      const matchesTag = !tag || (post.tags || []).some((value) => text(value).toLowerCase() === tag);
      return matchesQuery && matchesMood && matchesTag;
    });
  }

  function rankRelated(posts, current, limit) {
    const currentTags = new Set((current.tags || []).map((tag) => text(tag).toLowerCase()));
    return (posts || [])
      .filter((post) => post.slug !== current.slug)
      .map((post) => {
        const sharedTags = (post.tags || []).filter((tag) => currentTags.has(text(tag).toLowerCase())).length;
        return { post, score: (post.mood === current.mood ? 100 : 0) + (sharedTags * 10) };
      })
      .sort((a, b) => b.score - a.score || Number(a.post.sourceIndex || 0) - Number(b.post.sourceIndex || 0))
      .slice(0, Math.max(0, Number(limit || 3)))
      .map((entry) => entry.post);
  }

  function getAdjacent(posts, slug) {
    const list = posts || [];
    if (list.length < 2) return { previous: null, next: null };
    const index = list.findIndex((post) => post.slug === slug);
    if (index < 0) return { previous: null, next: null };
    return {
      previous: list[(index - 1 + list.length) % list.length],
      next: list[(index + 1) % list.length],
    };
  }

  function parseHash(hash) {
    const value = text(hash).replace(/^#/, '');
    if (!value) return { view: 'home' };
    if (value === 'about') return { view: 'about' };
    if (value.startsWith('poem/')) {
      try {
        return { view: 'reader', slug: decodeURIComponent(value.slice(5)) };
      } catch (_) {
        return { view: 'home' };
      }
    }
    return { view: 'home' };
  }

  function formatHash(route) {
    if (route && route.view === 'about') return '#about';
    if (route && route.view === 'reader' && route.slug) return `#poem/${encodeURIComponent(route.slug)}`;
    return '';
  }

  function clampReaderScale(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 1;
    return Math.min(1.4, Math.max(0.85, Math.round(numeric * 100) / 100));
  }

  function readPreference(storage, key, fallback) {
    try {
      const value = storage && storage.getItem(key);
      return value == null ? fallback : value;
    } catch (_) {
      return fallback;
    }
  }

  function storageOf(win) {
    try {
      return win ? win.localStorage : null;
    } catch (_) {
      return null;
    }
  }

  function writePreference(storage, key, value) {
    try {
      if (storage) storage.setItem(key, String(value));
    } catch (_) {}
  }

  function resolveRoute(route, posts, loaded) {
    if (!route || route.view !== 'reader') return { status: 'ready', route: route || { view: 'home' } };
    if (!loaded && !(posts || []).length) return { status: 'pending', route };
    if ((posts || []).some((post) => post.slug === route.slug)) return { status: 'ready', route };
    return { status: 'invalid', route: { view: 'home' } };
  }

  function proxyRequestUrl(value, options) {
    const config = options || {};
    try {
      const url = new URL(value);
      if (!/(^|\.)rss2json\.com$/.test(url.hostname)) return value;
      if (text(config.rss2jsonApiKey)) url.searchParams.set('api_key', text(config.rss2jsonApiKey));
      const count = Number(config.maxItems);
      if (Number.isFinite(count) && count > 0) url.searchParams.set('count', String(Math.floor(count)));
      return url.href;
    } catch (_) {
      return value;
    }
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function safeUrl(value) {
    try {
      const url = new URL(text(value), typeof location !== 'undefined' ? location.href : 'https://torchborne.invalid');
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch (_) {
      return '';
    }
  }

  const UNSAFE_TAGS = 'script,style,iframe,frame,frameset,object,embed,applet,form,input,button,textarea,select,base,link,meta,svg,math,template,noscript';
  const URL_ATTRIBUTE = /(^|:)(href|src|action|formaction|poster|background|cite)$/;

  function sanitizeArticle(html, doc) {
    if (!doc || !doc.createElement) return escapeHtml(stripHtml(html)).replace(/\n/g, '<br>');
    const template = doc.createElement('template');
    template.innerHTML = String(html || '');
    template.content.querySelectorAll(UNSAFE_TAGS).forEach((node) => node.remove());
    template.content.querySelectorAll('*').forEach((node) => {
      [...node.attributes].forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        if (name.startsWith('on') || name === 'style' || name === 'srcdoc') node.removeAttribute(attribute.name);
        else if (name !== 'href' && name !== 'src' && URL_ATTRIBUTE.test(name) && !safeUrl(attribute.value)) node.removeAttribute(attribute.name);
      });
      if (node.hasAttribute('href')) {
        const href = safeUrl(node.getAttribute('href'));
        if (href) {
          node.setAttribute('href', href);
          node.setAttribute('rel', 'noopener');
        } else node.removeAttribute('href');
      }
      if (node.hasAttribute('src')) {
        const src = safeUrl(node.getAttribute('src'));
        if (src) node.setAttribute('src', src);
        else node.removeAttribute('src');
      }
    });
    return template.innerHTML;
  }

  function init(doc, win) {
    if (!doc || !win) return null;
    const byId = (id) => doc.getElementById(id);
    const elements = {
      home: byId('homeView'), reader: byId('readerView'), about: byId('aboutView'),
      search: byId('searchInput'), moods: byId('moodFilters'), tags: byId('tagFilters'),
      grid: byId('postsGrid'), summary: byId('resultSummary'), status: byId('statusMessage'),
      empty: byId('emptyState'), clear: byId('clearFilters'), loadMore: byId('loadMore'),
      theme: byId('themeToggle'), progress: byId('readingProgress'),
      readerBack: byId('readerBack'), readerMeta: byId('readerMeta'), readerTitle: byId('readerTitle'),
      readerBody: byId('readerBody'), readerScale: byId('readerScale'), readerShare: byId('readerShare'),
      readerSource: byId('readerSource'), previous: byId('previousPost'), next: byId('nextPost'),
      related: byId('relatedGrid'), dialog: byId('subscribeDialog'),
      heroCount: byId('heroCount'), featured: byId('featuredPoem'), featuredLabel: byId('featuredLabel'),
      featuredLink: byId('featuredLink'), featuredMeta: byId('featuredMeta'), featuredVerse: byId('featuredVerse'),
      featuredRead: byId('featuredRead'), readerNumber: byId('readerNumber'),
    };
    if (!elements.home || !elements.grid) return null;

    const config = parseJson(byId('appConfig'), {});
    const initial = parseJson(byId('initialPostsData'), []);
    const state = {
      posts: Array.isArray(initial) ? initial.map(normalizePost) : [],
      postsLoaded: Array.isArray(initial) && initial.length > 0,
      view: 'home', slug: '', query: '', mood: 'all', tag: '', visible: 7,
      readerScale: clampReaderScale(readPreference(storageOf(win), 'torchborne-reader-scale', 1)),
      lastScroll: 0, dialogTrigger: null,
    };

    function parseJson(node, fallback) {
      try { return node ? JSON.parse(node.textContent || '') : fallback; } catch (_) { return fallback; }
    }

    function currentResults() {
      return filterPosts(state.posts, { query: state.query, mood: state.mood, tag: state.tag });
    }

    function dateLabel(value) {
      if (!value) return '';
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return text(value);
      return `${parsed.getDate()} ${new Intl.DateTimeFormat('en-US', { month: 'short' }).format(parsed)} ${parsed.getFullYear()}`;
    }

    function longDate(value) {
      const parsed = new Date(value);
      return value && !Number.isNaN(parsed.getTime())
        ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'long' }).format(parsed) : '';
    }

    function numberOf(post) {
      return romanize(state.posts.length - Number(post.sourceIndex || 0));
    }

    function verseFragment(blocks, dropCap) {
      const fragment = doc.createDocumentFragment();
      blocks.forEach((block, index) => {
        const node = doc.createElement('p');
        if (block.type === 'break') {
          node.className = 'fleuron'; node.setAttribute('aria-hidden', 'true'); node.textContent = '\u2767';
        } else {
          node.className = index === 0 && dropCap ? 'stanza has-drop-cap' : 'stanza';
          block.lines.forEach((line, lineIndex) => {
            if (lineIndex) node.append(doc.createElement('br'));
            node.append(doc.createTextNode(line));
          });
        }
        fragment.append(node);
      });
      return fragment;
    }

    function moodLabel(mood) {
      return mood ? mood.charAt(0).toUpperCase() + mood.slice(1) : '';
    }

    function postCard(post, compact) {
      const href = formatHash({ view: 'reader', slug: post.slug });
      const slug = escapeHtml(post.slug);
      const date = dateLabel(post.date) ? `<time>${escapeHtml(dateLabel(post.date))}</time>` : '';
      const mood = `<span class="mood-label mood-label--${post.mood}">${moodLabel(post.mood)}</span>`;
      const opening = post.opening ? `<span class="contents-row__opening">${escapeHtml(post.opening)}</span>` : '';
      const item = doc.createElement(compact ? 'article' : 'div');
      if (compact) {
        item.className = 'poem-card poem-card--compact';
        item.innerHTML = `<p class="poem-card__number">${numberOf(post)}. · ${mood}</p>
          <h3><a href="${href}" data-open-poem="${slug}">${escapeHtml(post.title)}</a></h3>${opening}`;
        return item;
      }
      item.className = 'contents-row';
      item.setAttribute('role', 'listitem');
      item.innerHTML = `<a class="contents-row__link" href="${href}" data-open-poem="${slug}">
        <span class="contents-row__number">${numberOf(post)}.</span>
        <span class="contents-row__main">
          <span class="contents-row__line"><span class="contents-row__title">${escapeHtml(post.title)}</span><span class="contents-row__leader" aria-hidden="true"></span>${date}</span>
          ${opening}
        </span>
        ${mood}
      </a>`;
      return item;
    }

    function renderFeatured() {
      if (!elements.featured) return;
      const post = pickFeatured(state.posts);
      elements.featured.hidden = !post;
      if (!post) return;
      const blocks = parseVerse(post.verse);
      const excerpt = [];
      let lines = 0;
      for (const block of blocks) {
        if (block.type === 'stanza' && (lines >= 10 || excerpt.filter((entry) => entry.type === 'stanza').length >= 2)) break;
        if (block.type === 'stanza') lines += block.lines.length;
        excerpt.push(block);
      }
      while (excerpt.length && excerpt[excerpt.length - 1].type === 'break') excerpt.pop();
      elements.featuredLabel.textContent = `From the contents \u00b7 ${numberOf(post)}.`;
      elements.featuredLink.textContent = post.title;
      [elements.featuredLink, elements.featuredRead].forEach((link) => {
        link.href = formatHash({ view: 'reader', slug: post.slug });
        link.dataset.openPoem = post.slug;
      });
      elements.featuredMeta.textContent = [`A poem of ${post.mood}`, longDate(post.date)].filter(Boolean).join(' \u00b7 ');
      if (excerpt.length) elements.featuredVerse.replaceChildren(verseFragment(excerpt, true));
      else {
        const note = doc.createElement('p');
        note.className = 'stanza'; note.textContent = post.opening || post.summary;
        elements.featuredVerse.replaceChildren(note);
      }
    }

    function renderHeroCount() {
      if (!elements.heroCount) return;
      const count = state.posts.length;
      const oldest = state.posts.reduce((earliest, post) => {
        const time = new Date(post.date).getTime();
        return Number.isFinite(time) && (!earliest || time < earliest) ? time : earliest;
      }, 0);
      const since = oldest ? new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(new Date(oldest)) : '';
      elements.heroCount.textContent = count ? `${count} ${count === 1 ? 'poem' : 'poems'}${since ? ` \u00b7 begun in ${since}` : ''}` : '';
      elements.heroCount.hidden = !count;
    }

    function renderTags() {
      const counts = new Map();
      state.posts.forEach((post) => post.tags.forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1)));
      const tags = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8);
      elements.tags.replaceChildren();
      tags.forEach(([tag]) => {
        const button = doc.createElement('button');
        button.type = 'button'; button.className = 'filter-chip filter-chip--tag';
        button.dataset.tag = tag; button.textContent = tag;
        button.setAttribute('aria-pressed', String(state.tag.toLowerCase() === tag.toLowerCase()));
        if (state.tag.toLowerCase() === tag.toLowerCase()) button.classList.add('is-active');
        elements.tags.append(button);
      });
      elements.tags.hidden = tags.length === 0;
    }

    function renderHome() {
      const results = currentResults();
      const visible = results.slice(0, state.visible);
      elements.grid.replaceChildren(...visible.map((post) => postCard(post, false)));
      elements.grid.hidden = !visible.length;
      elements.empty.hidden = Boolean(visible.length) || !state.posts.length;
      elements.status.hidden = Boolean(state.posts.length);
      elements.loadMore.hidden = results.length <= visible.length;
      const qualifier = state.query || state.mood !== 'all' || state.tag ? ' matching your search' : '';
      elements.summary.textContent = `${results.length} ${results.length === 1 ? 'poem' : 'poems'}${qualifier}`;
      const moodCounts = state.posts.reduce((counts, post) => ({ ...counts, [post.mood]: (counts[post.mood] || 0) + 1 }), {});
      elements.moods.querySelectorAll('[data-mood]').forEach((button) => {
        const active = button.dataset.mood === state.mood;
        const count = button.dataset.mood === 'all' ? state.posts.length : (moodCounts[button.dataset.mood] || 0);
        button.classList.toggle('is-active', active); button.setAttribute('aria-pressed', String(active));
        button.hidden = Boolean(state.posts.length) && !count && !active;
        const counter = button.querySelector('.filter-chip__count');
        if (counter) counter.textContent = state.posts.length ? String(count) : '';
      });
      renderTags();
      renderFeatured();
      renderHeroCount();
    }

    function showView(view) {
      state.view = view;
      elements.home.hidden = view !== 'home';
      elements.reader.hidden = view !== 'reader';
      elements.about.hidden = view !== 'about';
      doc.body.dataset.view = view;
      elements.progress.hidden = view !== 'reader';
      if (view !== 'reader') elements.progress.querySelector('span').style.width = '0%';
    }

    function renderReader(slug) {
      const post = state.posts.find((entry) => entry.slug === slug);
      if (!post) return false;
      state.slug = slug;
      elements.readerTitle.textContent = post.title;
      if (elements.readerNumber) elements.readerNumber.textContent = `${numberOf(post)}.`;
      elements.readerMeta.innerHTML = `<span class="mood-label mood-label--${post.mood}">A poem of ${post.mood}</span>${longDate(post.date) ? `<span aria-hidden="true">\u00b7</span><time>${escapeHtml(longDate(post.date))}</time>` : ''}`;
      elements.readerBody.innerHTML = sanitizeArticle(post.content || post.summary, doc);
      layoutVerse(elements.readerBody);
      elements.readerBody.style.setProperty('--reader-scale', state.readerScale);
      elements.readerScale.textContent = `${Math.round(state.readerScale * 100)}%`;
      elements.readerSource.href = safeUrl(post.link) || config.publicUrl || '#';
      elements.readerShare.dataset.share = encodeURIComponent(post.link);
      elements.readerShare.dataset.title = post.title;
      const results = currentResults();
      const adjacent = getAdjacent(results.some((entry) => entry.slug === slug) ? results : state.posts, slug);
      renderAdjacent(elements.previous, adjacent.previous, (post) => `\u2190 Newer \u00b7 ${numberOf(post)}.`);
      renderAdjacent(elements.next, adjacent.next, (post) => `Older \u00b7 ${numberOf(post)}. \u2192`);
      elements.related.replaceChildren(...rankRelated(state.posts, post, 3).map((entry) => postCard(entry, true)));
      showView('reader');
      doc.title = `${post.title} — Torchborne`;
      win.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
      return true;
    }

    function layoutVerse(container) {
      container.querySelectorAll('pre').forEach((pre) => {
        const blocks = parseVerse(pre.textContent);
        if (!blocks.length) { pre.remove(); return; }
        const verse = doc.createElement('div');
        verse.className = 'verse';
        verse.append(verseFragment(blocks, false));
        pre.replaceWith(verse);
      });
      const first = [...container.querySelectorAll('.stanza, p')].find((node) => !node.closest('figure') && text(node.textContent).length > 1);
      if (first) first.classList.add('has-drop-cap');
    }

    function showStatusNote(message) {
      elements.status.hidden = false;
      const note = elements.status.querySelector('p');
      if (note) note.textContent = message;
    }

    function renderAdjacent(button, post, label) {
      button.hidden = !post;
      button.disabled = !post;
      if (!post) return;
      button.dataset.openPoem = post.slug;
      button.innerHTML = `<span>${escapeHtml(label(post))}</span><strong>${escapeHtml(post.title)}</strong>${post.opening ? `<em>${escapeHtml(post.opening)}</em>` : ''}`;
    }

    function reducedMotion() {
      return Boolean(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    function isAppHash(hash) {
      return !hash || hash === '#' || hash === '#about' || hash.startsWith('#poem/');
    }

    function route() {
      if (!isAppHash(win.location.hash) && state.view === 'home') return;
      const parsed = parseHash(win.location.hash);
      const resolution = resolveRoute(parsed, state.posts, state.postsLoaded);
      if (resolution.status === 'pending') return;
      const target = resolution.route;
      if (target.view === 'reader' && renderReader(target.slug)) return;
      if (target.view === 'about') {
        showView('about'); doc.title = 'About — Torchborne'; win.scrollTo(0, 0); return;
      }
      showView('home'); renderHome(); doc.title = 'Torchborne';
      if (resolution.status === 'invalid') {
        showStatusNote('That poem is unavailable. The archive is ready below.');
        return;
      }
      if (state.lastScroll) win.requestAnimationFrame(() => win.scrollTo(0, state.lastScroll));
    }

    async function share(url, title) {
      const decoded = decodeURIComponent(url || '');
      try {
        if (win.navigator.share) await win.navigator.share({ title, url: decoded });
        else if (win.navigator.clipboard) await win.navigator.clipboard.writeText(decoded);
      } catch (_) {}
    }

    function setTheme(theme) {
      const value = theme === 'dark' ? 'dark' : 'light';
      doc.documentElement.dataset.theme = value;
      elements.theme.setAttribute('aria-pressed', String(value === 'dark'));
      elements.theme.setAttribute('aria-label', value === 'dark' ? 'Use light theme' : 'Use dark theme');
      writePreference(storageOf(win), 'torchborne-theme', value);
      const meta = byId('themeColorMeta'); if (meta) meta.content = value === 'dark' ? '#15130f' : '#f3eee4';
    }

    function openDialog(trigger) {
      state.dialogTrigger = trigger;
      if (typeof elements.dialog.showModal === 'function') elements.dialog.showModal();
      else elements.dialog.setAttribute('open', '');
      elements.dialog.querySelector('[data-dialog-close]')?.focus();
    }

    function closeDialog() {
      if (typeof elements.dialog.close === 'function') elements.dialog.close();
      else { elements.dialog.removeAttribute('open'); restoreDialogFocus(); }
    }

    function restoreDialogFocus() {
      state.dialogTrigger?.focus(); state.dialogTrigger = null;
    }

    function dialogOpen() {
      return Boolean(elements.dialog && (elements.dialog.open || elements.dialog.hasAttribute('open')));
    }

    function bindEvents() {
      doc.addEventListener('click', (event) => {
        const open = event.target.closest('[data-open-poem]');
        if (open) { event.preventDefault(); state.lastScroll = win.scrollY; win.location.hash = formatHash({ view: 'reader', slug: open.dataset.openPoem }); return; }
        const routeLink = event.target.closest('[data-route]');
        if (routeLink) {
          event.preventDefault(); win.location.hash = routeLink.dataset.route === 'about' ? '#about' : ''; route();
          const contents = routeLink.dataset.route === 'contents' && byId('contents');
          if (contents) win.requestAnimationFrame(() => contents.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth' }));
          return;
        }
        const mood = event.target.closest('[data-mood]');
        if (mood) { state.mood = mood.dataset.mood; state.visible = 7; renderHome(); return; }
        const tag = event.target.closest('[data-tag]');
        if (tag) { state.tag = state.tag === tag.dataset.tag ? '' : tag.dataset.tag; state.visible = 7; renderHome(); return; }
        const shareButton = event.target.closest('[data-share]');
        if (shareButton) { event.preventDefault(); share(shareButton.dataset.share, shareButton.dataset.title); return; }
        const subscribe = event.target.closest('[data-subscribe]');
        if (subscribe && elements.dialog) { event.preventDefault(); openDialog(subscribe); }
      });
      elements.search.addEventListener('input', () => { state.query = elements.search.value.trim(); state.visible = 7; renderHome(); });
      elements.clear.addEventListener('click', () => { state.query = ''; state.mood = 'all'; state.tag = ''; elements.search.value = ''; renderHome(); });
      elements.loadMore.addEventListener('click', () => { state.visible += 7; renderHome(); });
      elements.theme.addEventListener('click', () => setTheme(doc.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
      elements.readerBack.addEventListener('click', () => { win.location.hash = ''; route(); });
      doc.querySelector('[data-reader-inc]').addEventListener('click', () => adjustScale(0.1));
      doc.querySelector('[data-reader-dec]').addEventListener('click', () => adjustScale(-0.1));
      elements.dialog?.querySelector('[data-dialog-close]')?.addEventListener('click', closeDialog);
      elements.dialog?.addEventListener('click', (event) => { if (event.target === elements.dialog) closeDialog(); });
      elements.dialog?.addEventListener('close', restoreDialogFocus);
      win.addEventListener('hashchange', route);
      win.addEventListener('scroll', updateProgress, { passive: true });
      doc.addEventListener('keydown', (event) => {
        if (state.view !== 'reader' || event.defaultPrevented || dialogOpen()) return;
        const editable = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable;
        const modified = event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
        if (event.key === 'Escape') { win.location.hash = ''; route(); return; }
        if (editable || modified) return;
        if (event.key === 'ArrowLeft' && !elements.previous.hidden) elements.previous.click();
        if (event.key === 'ArrowRight' && !elements.next.hidden) elements.next.click();
      });
    }

    function adjustScale(delta) {
      state.readerScale = clampReaderScale(state.readerScale + delta);
      elements.readerBody.style.setProperty('--reader-scale', state.readerScale);
      elements.readerScale.textContent = `${Math.round(state.readerScale * 100)}%`;
      writePreference(storageOf(win), 'torchborne-reader-scale', state.readerScale);
    }

    function updateProgress() {
      if (state.view !== 'reader') return;
      const article = elements.readerBody;
      const start = article.getBoundingClientRect().top + win.scrollY - win.innerHeight * 0.25;
      const distance = Math.max(1, article.offsetHeight - win.innerHeight * 0.5);
      const percent = Math.min(100, Math.max(0, ((win.scrollY - start) / distance) * 100));
      elements.progress.querySelector('span').style.width = `${percent}%`;
    }

    async function loadPosts() {
      if (state.posts.length) { state.postsLoaded = true; renderHome(); route(); return; }
      const candidates = ['./data/posts.json'];
      if (config.proxyUrl && config.feedUrl) {
        const separator = /[?=&]$/.test(config.proxyUrl) ? '' : (config.proxyUrl.includes('?') ? '&rss_url=' : '?rss_url=');
        candidates.push(proxyRequestUrl(`${config.proxyUrl}${separator}${encodeURIComponent(config.feedUrl)}`, config));
      }
      for (const url of candidates) {
        try {
          const response = await win.fetch(url, { credentials: 'omit', cache: 'no-store' });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const payload = await response.json();
          const rows = Array.isArray(payload) ? payload : (payload.items || payload.posts || payload.data || []);
          if (Array.isArray(rows) && rows.length) { state.posts = rows.map(normalizePost); state.postsLoaded = true; renderHome(); route(); return; }
        } catch (_) {}
      }
      elements.status.hidden = false;
      elements.status.innerHTML = `<h3>The archive could not be reached</h3><p>Please try again, or read directly on <a href="${escapeHtml(config.publicUrl || '#')}">Substack</a>.</p><button class="button button--secondary" type="button" data-retry>Try again</button>`;
      elements.status.querySelector('[data-retry]')?.addEventListener('click', loadPosts, { once: true });
      elements.summary.textContent = 'Archive unavailable';
    }

    bindEvents();
    setTheme(doc.documentElement.dataset.theme || readPreference(storageOf(win), 'torchborne-theme', 'light'));
    renderHome(); route(); loadPosts();
    return { state, renderHome, route };
  }

  return {
    MOODS,
    classifyMood,
    clampReaderScale,
    filterPosts,
    formatHash,
    getAdjacent,
    normalizePost,
    openingLine,
    parseHash,
    parseVerse,
    pickFeatured,
    proxyRequestUrl,
    rankRelated,
    readPreference,
    romanize,
    resolveRoute,
    init,
    sanitizeArticle,
    slugify,
    stripHtml,
    verseTextOf,
    writePreference,
  };
});

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('DOMContentLoaded', function () {
    if (window.TorchborneApp) window.TorchborneApp.init(document, window);
  }, { once: true });
}
