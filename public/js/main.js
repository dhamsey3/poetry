/* Client-side UI script extracted from template: handles theme toggle, search, random post, card animations, and lightweight UI features. */

// Minimal initialization to wire up template IDs used in index.html.j2
document.addEventListener('DOMContentLoaded', () => {
  // --- keyboard vs pointer focus helper ---
  // Add 'user-is-tabbing' to <html> when user navigates via keyboard (Tab). Remove on mousedown.
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

  const els = {
    themeToggle: document.getElementById('themeToggle'),
    randomBtn: document.getElementById('randomBtn'),
    searchInput: document.getElementById('searchInput'),
    postsGrid: document.getElementById('postsGrid'),
  };

  // Quick preview variant: ?variant=screenshot will add .variant-screenshot to <html>
  try {
    const params = new URLSearchParams(window.location.search);
    const v = params.get('variant');
    if (v === 'screenshot') document.documentElement.classList.add('variant-screenshot');
    if (v === 'polish') document.documentElement.classList.add('variant-polish');
    if (v === 'creative') document.documentElement.classList.add('variant-creative');

    // Developer-only on-screen toggle when ?dev=1 is present
    if (params.get('dev') === '1') {
      const btn = document.createElement('button');
      btn.textContent = '🎨 Variant';
      btn.id = 'devVariantToggle';
      btn.style.position = 'fixed';
      btn.style.right = '12px';
      btn.style.bottom = '12px';
      btn.style.zIndex = 9999;
      btn.style.padding = '8px 10px';
      btn.style.borderRadius = '8px';
      btn.className = 'chip';
      document.body.appendChild(btn);
      btn.addEventListener('click', () => {
        // cycle between none -> polish -> creative -> none
        if (document.documentElement.classList.contains('variant-creative')) {
          document.documentElement.classList.remove('variant-creative');
        } else if (document.documentElement.classList.contains('variant-polish')) {
          document.documentElement.classList.remove('variant-polish');
          document.documentElement.classList.add('variant-creative');
        } else {
          document.documentElement.classList.add('variant-polish');
        }
      });
    }
  } catch (e) { /* ignore in weird embed contexts */ }

  // Theme toggle (sync with data-theme attribute)
  function getPreferred() {
    const saved = localStorage.getItem('vv-theme');
    if (saved) return saved;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function applyTheme(mode) {
    document.documentElement.setAttribute('data-theme', mode);
    localStorage.setItem('vv-theme', mode);
    const icon = document.getElementById('themeIcon');
    const text = document.getElementById('themeText');
    if (icon) icon.textContent = mode === 'dark' ? '☀️' : '🌙';
    if (text) text.textContent = mode === 'dark' ? 'Light mode' : 'Dark mode';
  }
  applyTheme(getPreferred());
  els.themeToggle && els.themeToggle.addEventListener('click', () => applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));

  // Random post
  function highlightAndScroll(el) {
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('highlight');
    setTimeout(() => el.classList.remove('highlight'), 2200);
    el.setAttribute('tabindex', '-1');
    try { el.focus({ preventScroll: true }); } catch (e) {}
  }
  if (els.randomBtn) els.randomBtn.addEventListener('click', () => {
    const posts = Array.from(document.querySelectorAll('.posts-grid .card'));
    if (!posts.length) return;
    highlightAndScroll(posts[Math.floor(Math.random() * posts.length)]);
  });

  // Search filter
  if (els.searchInput) els.searchInput.addEventListener('input', (e) => {
    const q = (e.target.value || '').trim().toLowerCase();
    document.querySelectorAll('.posts-grid .card').forEach(it => {
      it.style.display = (!q || it.textContent.toLowerCase().includes(q)) ? '' : 'none';
    });
  });

  // Card animation delays
  function applyCardDelays() {
    document.querySelectorAll('.posts-grid .card').forEach((card, i) => {
      card.style.animationDelay = `${i * 70}ms`;
      card.classList.remove('show'); card.offsetHeight; card.classList.add('show');
    });
  }
  applyCardDelays();
  if (els.postsGrid) new MutationObserver(() => applyCardDelays()).observe(els.postsGrid, { childList: true });
});
