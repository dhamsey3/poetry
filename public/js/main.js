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

  // Basic modal & sanitization (uses DOMPurify if available)
  function sanitize(html){ const raw = String(html||''); const cleaned = (typeof DOMPurify !== 'undefined' && DOMPurify.sanitize) ? DOMPurify.sanitize(raw) : raw; const d = document.createElement('div'); d.innerHTML = cleaned; d.querySelectorAll('iframe,object,embed,style').forEach(e=>e.remove()); return d.innerHTML; }

  // Content manager (adapted, minimal): builds cards and loads posts from static/proxy sources
  class ContentManager {
    constructor(){ this.posts = []; this.pageSize = 6; this.shown = 0; this.viewList = []; this.inlineConsumed = false; }
    constructor(){ this.posts = []; this.pageSize = 6; this.shown = 0; this.viewList = []; this.inlineConsumed = false; this.currentIndex = -1; }
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
