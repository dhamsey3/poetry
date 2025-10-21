/* Unified client script: theme, variants, UI helpers, and content loading/rendering */

(function(){
  // Keyboard focus helper
  (function keyboardFocus() {
    const html = document.documentElement;
    function handleFirstTab(e) {
      if (e.key === 'Tab') {
        html.classList.add('user-is-tabbing');
        window.removeEventListener('keydown', handleFirstTab);
        window.addEventListener('mousedown', handleMouseDownOnce);
      }
    }
    function handleMouseDownOnce() { html.classList.remove('user-is-tabbing'); window.removeEventListener('mousedown', handleMouseDownOnce); window.addEventListener('keydown', handleFirstTab); }
    window.addEventListener('keydown', handleFirstTab);
  })();

  // Variant handling from URL and dev toggle
  try {
    const params = new URLSearchParams(window.location.search);
    const v = params.get('variant');
    if (v === 'screenshot') document.documentElement.classList.add('variant-screenshot');
    if (v === 'polish') document.documentElement.classList.add('variant-polish');
    if (v === 'creative') document.documentElement.classList.add('variant-creative');
    if (params.get('dev') === '1') {
      const btn = document.createElement('button');
      btn.textContent = '🎨 Variant'; btn.id = 'devVariantToggle'; btn.className = 'chip';
      Object.assign(btn.style, { position: 'fixed', right: '12px', bottom: '12px', zIndex: 9999, padding: '8px 10px', borderRadius: '8px' });
      document.body.appendChild(btn);
      btn.addEventListener('click', () => {
        if (document.documentElement.classList.contains('variant-creative')) { document.documentElement.classList.remove('variant-creative'); }
        else if (document.documentElement.classList.contains('variant-polish')) { document.documentElement.classList.remove('variant-polish'); document.documentElement.classList.add('variant-creative'); }
        else { document.documentElement.classList.add('variant-polish'); }
      });
    }
  } catch (e) {}

  // Small helpers
  const cfg = window.SITE_CONFIG || {};
  const getEl = id => document.getElementById(id);
  const DEFAULT_LIMIT = toNumber(cfg.MAX_ITEMS, 50);
  const STATIC_DATA_URL = cfg.STATIC_DATA_URL || './data/posts.json';
  const SUBSTACK_INFO = deriveSubstackInfo(cfg);
  const SUBSTACK_ORIGIN = SUBSTACK_INFO.origin;

  // Theme management
  function applyTheme(mode) { document.documentElement.setAttribute('data-theme', mode); try { localStorage.setItem('vv-theme', mode); } catch(e){} const icon = getEl('themeIcon'); const text = getEl('themeText'); if (icon) icon.textContent = mode === 'dark' ? '☀️' : '🌙'; if (text) text.textContent = mode === 'dark' ? 'Light mode' : 'Dark mode'; }
  function getPreferred() { try { const saved = localStorage.getItem('vv-theme'); if (saved) return saved; } catch(e){} return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
  applyTheme(getPreferred());

  // Minimal exported UI elements for other modules
  const els = {
    themeToggle: getEl('themeToggle'),
    randomBtn: getEl('randomBtn'),
    searchInput: getEl('searchInput'),
    postsGrid: getEl('postsGrid'),
    refreshBtn: getEl('refreshBtn'),
    loadMore: getEl('loadMore'),
    status: getEl('statusMessage'),
    progressBar: getEl('progressBar'),
    particles: getEl('particles'),
    aboutBtn: getEl('aboutBtn'),
    aboutModal: getEl('aboutModal'),
    aboutClose: getEl('aboutModalClose'),
    footerAbout: getEl('footerAboutLink'),
    readingModal: getEl('readingModal'),
    readingClose: getEl('readingModalClose'),
    modalTitle: getEl('modalTitle'),
    modalMeta: getEl('modalMeta'),
    modalBody: getEl('modalBody'),
    prev: getEl('prevPost'), next: getEl('nextPost')
  };

  // Light utilities
  const debounce = (fn, ms=200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const escapeHtml = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');

  function toNumber(value, fallback){
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  }

  function deriveSubstackInfo(config){
    const raw = (config.POSTS_BASE || config.RSS_URL || '').trim();
    if (!raw) return { origin: '', host: '', slug: '' };
    try {
      const normalized = raw.includes('://') ? raw : `https://${raw}`;
      const url = new URL(normalized);
      const origin = `${url.protocol || 'https:'}//${url.hostname}`.replace(/\/$/, '');
      const host = url.hostname;
      const slug = host.endsWith('.substack.com') ? host.slice(0, -'.substack.com'.length) : host;
      return { origin, host, slug };
    } catch (_) {
      return { origin: '', host: '', slug: '' };
    }
  }

  function normalizeTagValue(tag){
    if (!tag) return '';
    if (typeof tag === 'string') return tag.trim();
    const candidate = tag.term || tag.name || tag.slug || tag.label || tag.title;
    return typeof candidate === 'string' ? candidate.trim() : '';
  }

  function normalizePost(raw){
    if (!raw || typeof raw !== 'object') return null;
    const copy = { ...raw };
    const slug = typeof copy.slug === 'string' ? copy.slug.trim() : '';
    const linkCandidates = [
      copy.link,
      copy.url,
      copy.guid,
      copy.canonical_url,
      copy.post_url,
      copy.original_url,
      copy.permalink,
      copy.href
    ];
    let link = '';
    for (const candidate of linkCandidates){
      if (typeof candidate === 'string' && candidate.trim()){ link = candidate.trim(); break; }
    }
    if (!link && slug && SUBSTACK_ORIGIN){
      const base = SUBSTACK_ORIGIN.replace(/\/$/, '');
      const safeSlug = slug.replace(/^\//, '');
      link = `${base}/p/${safeSlug}`;
    }
    copy.link = link || '#';
    copy.url = copy.link;
    const pubDate = copy.pubDate || copy.pubdate || copy.date || copy.post_date || copy.published_at || copy.created_at || copy.updated_at || '';
    copy.pubDate = typeof pubDate === 'string' ? pubDate : String(pubDate || '');
    const content = copy.content || copy['content:encoded'] || copy.html || copy.body_html || copy.description || copy.excerpt || '';
    copy.content = typeof content === 'string' ? content : String(content || '');
    const description = copy.description || copy.excerpt || copy.subtitle || copy.summary || copy.body_text || '';
    copy.description = typeof description === 'string' ? description : String(description || '');
    const rawTags = Array.isArray(copy.tags) ? copy.tags : Array.isArray(copy.categories) ? copy.categories : Array.isArray(copy.sections) ? copy.sections : [];
    copy.tags = rawTags.map(normalizeTagValue).filter(Boolean);
    const titleCandidate = copy.title || copy.subject || copy.headline || copy.name || '';
    copy.title = String(titleCandidate || '').trim() || 'Untitled';
    return copy;
  }

  // Basic modal & sanitization (uses DOMPurify if available)
  function sanitize(html){ const raw = String(html||''); const cleaned = (typeof DOMPurify !== 'undefined' && DOMPurify.sanitize) ? DOMPurify.sanitize(raw) : raw; const d = document.createElement('div'); d.innerHTML = cleaned; d.querySelectorAll('iframe,object,embed,style').forEach(e=>e.remove()); return d.innerHTML; }

  // Content manager (adapted, minimal): builds cards and loads posts from static/proxy sources
  class ContentManager {
    constructor(){
      this.posts = [];
      this.pageSize = 6;
      this.shown = 0;
      this.viewList = [];
      this.inlineConsumed = false;
      this.currentIndex = -1;
      this.archiveEndpoint = SUBSTACK_ORIGIN ? `${SUBSTACK_ORIGIN}/api/v1/archive?sort=new` : '';
      this.maxItems = DEFAULT_LIMIT;
    }

    init(){
      els.searchInput = getEl('searchInput');
      const refresh = getEl('refreshBtn');
      if (refresh) refresh.addEventListener('click', () => this.load(true));

      const rnd = getEl('randomBtn');
      if (rnd) rnd.addEventListener('click', () => this.random());

      const lm = getEl('loadMore');
      if (lm) lm.addEventListener('click', () => this.renderNextChunk());

      const prevBtn = getEl('prevPost');
      if (prevBtn) prevBtn.addEventListener('click', () => this.prevPost());
      const nextBtn = getEl('nextPost');
      if (nextBtn) nextBtn.addEventListener('click', () => this.nextPost());

      const rClose = getEl('readingModalClose');
      if (rClose){
        rClose.addEventListener('click', () => {
          const modal = getEl('readingModal');
          if (!modal) return;
          modal.hidden = true;
          modal.classList.remove('open');
          modal.setAttribute('aria-hidden','true');
        });
      }

      const inline = document.getElementById('initialPostsData');
      if (inline){
        try {
          const parsed = JSON.parse(inline.textContent || '[]');
          const initial = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.posts) ? parsed.posts : []);
          const normalized = this.normalizeList(initial);
          if (normalized.length){
            this.posts = normalized;
            this.inlineConsumed = true;
            this.render(this.posts);
          }
        } catch (err) {
          console.warn('Inline posts JSON invalid', err);
        }
        inline.remove();
      }

      this.load();
    }

    normalizeList(list){
      return Array.isArray(list) ? list.map(normalizePost).filter(Boolean) : [];
    }

    pickList(payload){
      if (!payload) return [];
      if (Array.isArray(payload)) return payload;
      if (Array.isArray(payload.posts)) return payload.posts;
      if (Array.isArray(payload.items)) return payload.items;
      if (Array.isArray(payload.data)) return payload.data;
      if (Array.isArray(payload.results)) return payload.results;
      return [];
    }

    setPosts(list){
      const normalized = this.normalizeList(list);
      if (!normalized.length) return false;
      this.posts = normalized;
      this.render(this.posts);
      return true;
    }

    showStatus(message = '', { error = false } = {}){
      if (!els.status) return;
      if (!message){
        els.status.hidden = true;
        els.status.className = 'status';
        els.status.textContent = '';
        els.status.removeAttribute('role');
        return;
      }
      els.status.hidden = false;
      els.status.className = error ? 'status error' : 'status';
      els.status.textContent = message;
      if (error) els.status.setAttribute('role','alert');
      else els.status.removeAttribute('role');
    }

    card(post, idx){
      const date = post.pubDate ? new Date(post.pubDate) : null;
      const safeHtml = sanitize(post.content || post.description || '');
      const parsed = new DOMParser().parseFromString(safeHtml, 'text/html');
      const txt = parsed.body.textContent || '';
      const img = parsed.querySelector('img')?.src || null;
      const rt = txt ? `${Math.max(1, Math.round((txt.trim().split(/\s+/).length)/180))} min read` : '';
      const tags = Array.isArray(post.tags) ? post.tags : [];
      const el = document.createElement('article');
      const palettes = ['accent','accent-2','accent-3'];
      el.className = `card ${palettes[idx % palettes.length]}`;
      el.setAttribute('aria-label', post.title || 'Poem');
      el.innerHTML = `
        ${img ? `<div class="card-thumb"><img loading="lazy" decoding="async" src="${img}" alt=""/></div>` : `<div class="card-thumb" aria-hidden="true"></div>`}
        <div class="card-content">
          <h2 class="card-title"><a href="${post.link||post.url||'#'}" target="_blank" rel="noopener">${escapeHtml(post.title||'Untitled')}</a></h2>
          <div class="card-meta">
            ${date ? `<span>📅 ${escapeHtml(date.toLocaleDateString())}</span>` : ''}
            ${rt ? `<span>⏱️ ${escapeHtml(rt)}</span>` : ''}
          </div>
          <div class="card-summary">${escapeHtml(txt.slice(0,240))}${txt.length>240?'…':''}</div>
          ${tags.length ? `<div class="card-badges">${tags.map(t=>`<span class="badge">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
          <div class="card-actions">
            <a href="${post.link||post.url||'#'}" target="_blank" rel="noopener">Read on Substack →</a>
            <button type="button" class="linklike" data-quick-read="1" aria-controls="readingModal">Quick read</button>
            <a href="#" data-share="${encodeURIComponent(post.link||post.url||'')}" data-title="${escapeHtml(post.title||'Poem')}">Share</a>
          </div>
        </div>
      `;
      el.querySelector('[data-quick-read]')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.openReading(post);
      });
      const im = el.querySelector('.card-thumb img');
      if (im){
        if (im.complete) im.setAttribute('data-loaded','1');
        else im.addEventListener('load', () => im.setAttribute('data-loaded','1'));
      }
      return el;
    }

    render(list){
      this.viewList = Array.isArray(list) ? list : [];
      this.shown = 0;
      const grid = getEl('postsGrid');
      if (!grid) return;
      grid.hidden = false;
      grid.innerHTML = '';
      if (!this.viewList.length){
        this.updateLoadMore();
        this.showStatus('No poems available right now. You can read on Substack via the links below.');
        return;
      }
      this.showStatus('');
      this.renderNextChunk();
    }

    renderNextChunk(){
      const grid = getEl('postsGrid');
      if (!grid) return;
      const slice = this.viewList.slice(this.shown, this.shown + this.pageSize);
      slice.forEach((post) => {
        const idx = this.posts.indexOf(post);
        const card = this.card(post, idx >= 0 ? idx : 0);
        grid.appendChild(card);
        requestAnimationFrame(() => card.classList.add('show'));
      });
      this.shown += slice.length;
      this.updateLoadMore();
    }

    updateLoadMore(){
      if (!els.loadMore) return;
      const remaining = Math.max(0, this.viewList.length - this.shown);
      if (remaining > 0){
        els.loadMore.style.display = 'inline-flex';
        els.loadMore.textContent = `Load older poems (${remaining})`;
      } else {
        els.loadMore.style.display = 'none';
      }
    }

    random(){
      if (!this.posts.length) return;
      const idx = Math.floor(Math.random() * this.posts.length);
      this.openReading(this.posts[idx]);
    }

    async load(force=false){
      let success = Boolean(this.posts.length);
      if (!success) this.showStatus(force ? 'Refreshing poems from the digital ether...' : 'Gathering poems from the digital ether...');

      try {
        const data = await this.fetchJson(`${STATIC_DATA_URL}${force ? `?_=${Date.now()}` : ''}`);
        const list = this.pickList(data);
        if (this.setPosts(list)) success = true;
      } catch (err) {
        if (err && err.name !== 'AbortError') console.warn('Static posts unavailable', err);
      }

      if (!success || force){
        const sources = this.buildSources(force);
        for (const url of sources){
          const list = await this.tryFetchList(url);
          if (this.setPosts(list)){ success = true; break; }
        }
      }

      if (!success){
        const fallback = await this.fetchSubstackArchive(force);
        if (this.setPosts(fallback)) success = true;
      }

      if (!success){
        this.showStatus('Unable to load poems right now. You can read on Substack via the links below.', { error: true });
      } else {
        this.showStatus('');
      }
    }

    buildSources(force=false){
      const sources = [];
      const rssUrl = cfg.RSS_URL || (SUBSTACK_ORIGIN ? `${SUBSTACK_ORIGIN}/feed` : '');
      const workerBase = this.normalizeProxyBase(cfg.WORKER_BASE || '');
      if (workerBase && rssUrl){
        sources.push(workerBase + encodeURIComponent(rssUrl) + (force ? `&_=${Date.now()}` : ''));
      }
      if (rssUrl){
        const max = Number.isFinite(this.maxItems) ? this.maxItems : DEFAULT_LIMIT;
        const base = cfg.RSS2JSON_KEY
          ? `https://api.rss2json.com/v1/api.json?api_key=${encodeURIComponent(cfg.RSS2JSON_KEY)}&count=${encodeURIComponent(max)}&rss_url=`
          : `https://api.rss2json.com/v1/api.json?count=${encodeURIComponent(max)}&rss_url=`;
        sources.push(base + encodeURIComponent(rssUrl) + (force ? `&_=${Date.now()}` : ''));
      }
      return sources;
    }

    normalizeProxyBase(base){
      const trimmed = (base || '').trim();
      if (!trimmed) return '';
      if (/[?&]rss_url=/.test(trimmed)) return trimmed.endsWith('=') ? trimmed : `${trimmed}`;
      if (!trimmed.includes('?')) return `${trimmed}?rss_url=`;
      if (/[?&]$/.test(trimmed)) return `${trimmed}rss_url=`;
      return `${trimmed}&rss_url=`;
    }

    async tryFetchList(url){
      if (!url) return [];
      try {
        const data = await this.fetchJson(url);
        return this.pickList(data);
      } catch (err) {
        if (err && err.name !== 'AbortError') console.warn('Feed source failed', url, err);
        return [];
      }
    }

    sanitizeJsonEnvelope(text){
      if (!text) return '';
      let cleaned = text.trim();
      if (!cleaned) return '';
      // Many Substack APIs prefix responses with `while(1);` or similar guards
      cleaned = cleaned.replace(/^while\(1\);?/, '');
      cleaned = cleaned.replace(/^\)\]\}'/, '');
      return cleaned.trim();
    }

    async fetchJson(url){
      const res = await fetch(url, { cache: 'no-store', credentials: 'omit' });
      if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : 0}`);
      const text = await res.text();
      const trimmed = this.sanitizeJsonEnvelope(text);
      if (!trimmed) return null;
      try { return JSON.parse(trimmed); } catch (_) { throw new Error('Invalid JSON'); }
    }

    async fetchSubstackArchive(force=false){
      const limit = Number.isFinite(this.maxItems) ? this.maxItems : DEFAULT_LIMIT;
      const params = [];
      if (Number.isFinite(limit)) params.push(`limit=${encodeURIComponent(limit)}`);
      if (force) params.push(`_=${Date.now()}`);
      const query = params.length ? `?${params.join('&')}` : '';
      const endpoints = [];
      if (this.archiveEndpoint){
        const hasQuery = this.archiveEndpoint.includes('?');
        const url = `${this.archiveEndpoint}${hasQuery ? query.replace('?', '&') : query}`;
        endpoints.push(url);
      }
      if (SUBSTACK_ORIGIN){
        const base = `${SUBSTACK_ORIGIN}/api/v1/posts?sort=new`;
        endpoints.push(`${base}${query}`);
      }
      for (const endpoint of endpoints){
        try {
          const data = await this.fetchJson(endpoint);
          const list = this.pickList(data);
          if (list && list.length) return list;
        } catch (err) {
          if (err && err.name !== 'AbortError') console.warn('Archive fallback failed', endpoint, err);
        }
      }
      return [];
    }

    openReading(post){
      const modal = getEl('readingModal');
      const body = getEl('modalBody');
      const title = getEl('modalTitle');
      const meta = getEl('modalMeta');
      if (!modal || !body || !title || !meta) return;

      let idx = this.posts.indexOf(post);
      if (idx < 0 && post) idx = this.posts.findIndex(item => item.link === post.link);
      if (idx < 0) idx = 0;
      this.currentIndex = idx;
      const current = this.posts[idx];
      title.textContent = current?.title || 'Untitled';
      meta.textContent = current?.pubDate ? new Date(current.pubDate).toLocaleDateString() : '';
      body.innerHTML = sanitize(current?.content || current?.description || '');
      modal.removeAttribute('hidden');
      modal.classList.add('open');
      modal.setAttribute('aria-hidden','false');
    }

    prevPost(){
      if (this.currentIndex > 0) this.openReading(this.posts[this.currentIndex - 1]);
    }

    nextPost(){
      if (this.currentIndex < this.posts.length - 1) this.openReading(this.posts[this.currentIndex + 1]);
    }
    }
    init(){ els.searchInput = getEl('searchInput');
      // refresh and random
      const refresh = getEl('refreshBtn'); if (refresh) refresh.addEventListener('click', ()=> this.load(true));
      const rnd = getEl('randomBtn'); if (rnd) rnd.addEventListener('click', ()=> this.random());
      // load more
      const lm = getEl('loadMore'); if (lm) lm.addEventListener('click', ()=> this.renderNextChunk());
      // prev/next inside reading modal
      const prevBtn = getEl('prevPost'); if (prevBtn) prevBtn.addEventListener('click', ()=> this.prevPost());
      const nextBtn = getEl('nextPost'); if (nextBtn) nextBtn.addEventListener('click', ()=> this.nextPost());
      // modal close
      const rClose = getEl('readingModalClose'); if (rClose) rClose.addEventListener('click', ()=> { const m = getEl('readingModal'); if (m){ m.hidden = true; m.classList.remove('open'); m.setAttribute('aria-hidden','true'); } });

      const inline = document.getElementById('initialPostsData'); if (inline){ try { const parsed = JSON.parse(inline.textContent || '[]'); if (Array.isArray(parsed)) { this.posts = parsed; this.inlineConsumed = true; this.render(this.posts); } } catch(e){} inline.remove(); }
      this.load(); }

    card(post, idx){ const date = post.pubDate ? new Date(post.pubDate) : null; const html = post.content || post.description || ''; const txt = (new DOMParser()).parseFromString(sanitize(html), 'text/html').body.textContent || ''; const img = (new DOMParser()).parseFromString(sanitize(html), 'text/html').querySelector('img')?.src || null; const rt = txt ? `${Math.max(1, Math.round((txt.trim().split(/\s+/).length)/180))} min read` : ''; const tags = Array.isArray(post.tags)?post.tags:[]; const el = document.createElement('article'); const palettes = ['accent','accent-2','accent-3']; el.className = `card ${palettes[idx % palettes.length]}`; el.setAttribute('aria-label', post.title || 'Poem'); el.innerHTML = `${img?`<div class="card-thumb"><img loading="lazy" decoding="async" src="${img}" alt=""/></div>`:`<div class="card-thumb" aria-hidden="true"></div>`}<div class="card-content"><h2 class="card-title"><a href="${post.link||post.url||'#'}" target="_blank" rel="noopener">${escapeHtml(post.title||'Untitled')}</a></h2><div class="card-meta">${date?`<span>📅 ${escapeHtml(date.toLocaleDateString())}</span>`:''}${rt?`<span>⏱️ ${escapeHtml(rt)}</span>`:''}</div><div class="card-summary">${escapeHtml(txt.slice(0,240))}${txt.length>240?'…':''}</div>${tags.length?`<div class="card-badges">${tags.map(t=>`<span class="badge">${escapeHtml(t)}</span>`).join('')}</div>`:''}<div class="card-actions"><a href="${post.link||post.url||'#'}" target="_blank" rel="noopener">Read on Substack →</a><button type="button" class="linklike" data-quick-read="1" aria-controls="readingModal">Quick read</button><a href="#" data-share="${encodeURIComponent(post.link||post.url||'')}" data-title="${escapeHtml(post.title||'Poem')}">Share</a></div></div>`; el.querySelector('[data-quick-read]')?.addEventListener('click', e=>{ e.preventDefault(); e.stopPropagation(); this.openReading(post); }); const im = el.querySelector('.card-thumb img'); if(im){ if(im.complete) im.setAttribute('data-loaded','1'); else im.addEventListener('load',()=>im.setAttribute('data-loaded','1')); } return el; }

    render(list){ this.viewList = list; this.shown = 0; if (getEl('postsGrid')) getEl('postsGrid').hidden = false; const grid = getEl('postsGrid'); if(!grid) return; grid.innerHTML=''; this.renderNextChunk(); if (els.status) { els.status.hidden = true; } }
    renderNextChunk(){ const grid = getEl('postsGrid'); const slice = this.viewList.slice(this.shown, this.shown + this.pageSize); slice.forEach((p)=>{ const idx = this.posts.indexOf(p); const c = this.card(p, idx>=0?idx:0); grid.appendChild(c); requestAnimationFrame(()=>c.classList.add('show')); }); this.shown += slice.length; const remaining = Math.max(0, this.viewList.length - this.shown); if (els.loadMore) els.loadMore.style.display = remaining>0?'inline-flex':'none'; }
  random(){ if(!this.posts.length) return; const idx = Math.floor(Math.random()*this.posts.length); this.openReading(this.posts[idx]); }
  async load(force=false){ const STATIC = cfg.STATIC_DATA_URL || './data/posts.json'; let success = Boolean(this.posts.length); if (!success) { if (els.postsGrid) els.postsGrid.hidden = false; if (els.status) { els.status.hidden = false; els.status.textContent = 'Gathering poems from the digital ether...'; } } // try local static data
      try { const res = await fetch(STATIC + (force?`?_=${Date.now()}`:''), { cache:'no-store' }); if (res && res.ok){ const data = await res.json(); if (Array.isArray(data) || Array.isArray(data.posts)) { const list = Array.isArray(data)?data:data.posts; this.posts = list; this.render(this.posts); success = true; } } } catch(e){}
      // try proxy/public sources
      if (!success || force){ const worker = cfg.WORKER_BASE ? (cfg.WORKER_BASE + encodeURIComponent(cfg.RSS_URL||'')) : null; const publicBase = (cfg.RSS2JSON_KEY ? `https://api.rss2json.com/v1/api.json?api_key=${encodeURIComponent(cfg.RSS2JSON_KEY)}&count=${encodeURIComponent(cfg.MAX_ITEMS||50)}&rss_url=` : `https://api.rss2json.com/v1/api.json?count=${encodeURIComponent(cfg.MAX_ITEMS||50)}&rss_url=`); const sources = []; if (worker) sources.push(worker + (force?`&_=${Date.now()}`:'')); sources.push(publicBase + encodeURIComponent(cfg.RSS_URL||'')); for (const url of sources){ try { const res = await fetch(url, { cache:'no-store' }); if (!res.ok) continue; const data = await res.json(); const list = Array.isArray(data)?data:(Array.isArray(data.posts)?data.posts:(Array.isArray(data.items)?data.items:(Array.isArray(data.data)?data.data:[]))); if (list && list.length){ this.posts = list; this.render(this.posts); success = true; break; } } catch(e){} } }
      if (!success){ if (els.status){ els.status.hidden = false; els.status.className = 'status error'; els.status.textContent = 'Unable to load poems right now. You can read on Substack via the links below.'; } }
    }
    openReading(post){ const modal = getEl('readingModal'); const body = getEl('modalBody'); const title = getEl('modalTitle'); const meta = getEl('modalMeta'); if (!modal || !body) return; // set current index for prev/next
      const idx = this.posts.indexOf(post);
      this.currentIndex = idx >= 0 ? idx : this.currentIndex;
      title.textContent = post.title || 'Untitled'; meta.textContent = post.pubDate? new Date(post.pubDate).toLocaleDateString() : ''; body.innerHTML = sanitize(post.content || post.description || ''); modal.removeAttribute('hidden'); modal.classList.add('open'); modal.setAttribute('aria-hidden','false'); }
    prevPost(){ if (this.currentIndex > 0) { this.openReading(this.posts[this.currentIndex - 1]); } }
    nextPost(){ if (this.currentIndex < this.posts.length - 1) { this.openReading(this.posts[this.currentIndex + 1]); } }
  }


  // Initialize
  document.addEventListener('DOMContentLoaded', ()=>{
    const content = new ContentManager(); content.init();
    // wire theme toggle (attach after DOM ready so elements exist)
    const themeToggle = getEl('themeToggle'); if (themeToggle) themeToggle.addEventListener('click', () => applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));
    // about modal wiring
    const aboutBtn = getEl('aboutBtn'); const aboutModal = getEl('aboutModal'); const aboutClose = getEl('aboutModalClose'); const footerAbout = getEl('footerAboutLink');
    function showAbout(){ if (aboutModal){ aboutModal.removeAttribute('hidden'); aboutModal.setAttribute('aria-hidden','false'); aboutModal.classList.add('open'); } }
    function hideAbout(){ if (aboutModal){ aboutModal.hidden = true; aboutModal.setAttribute('aria-hidden','true'); aboutModal.classList.remove('open'); } }
    if (aboutBtn) aboutBtn.addEventListener('click', ()=> showAbout());
    if (footerAbout) footerAbout.addEventListener('click', (e)=>{ e.preventDefault(); showAbout(); });
    if (aboutClose) aboutClose.addEventListener('click', ()=> hideAbout());

    // reading modal close via Escape key
    document.addEventListener('keydown', (ev)=>{ if (ev.key === 'Escape'){ const rm = getEl('readingModal'); if (rm && !rm.hidden){ rm.hidden = true; rm.setAttribute('aria-hidden','true'); rm.classList.remove('open'); } const am = getEl('aboutModal'); if (am && !am.hidden){ am.hidden = true; am.setAttribute('aria-hidden','true'); am.classList.remove('open'); } } });

    // basic search wiring
    const s = getEl('searchInput'); if (s) s.addEventListener('input', debounce(()=>{ const q=(s.value||'').trim().toLowerCase(); const cards=Array.from(document.querySelectorAll('.posts-grid .card')); if(!q){ cards.forEach(c=>c.style.display=''); return;} cards.forEach(c=> c.style.display = c.textContent.toLowerCase().includes(q)?'':'none' ); }, 120));
  }, { passive: true });
})();
