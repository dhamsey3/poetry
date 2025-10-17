const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

async function run() {
  const dist = path.resolve(__dirname, '..', 'dist');
  const index = path.join(dist, 'index.html');
  if (!fs.existsSync(index)) { console.error('dist/index.html missing'); process.exit(2); }
  const html = fs.readFileSync(index, 'utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable' });
  // stub DOMPurify if not present
  dom.window.DOMPurify = { sanitize: (s) => s };

  // wait for scripts to load
  await new Promise((res) => { setTimeout(res, 500); });

  // attempt to require and execute main.js in the JSDOM context
  const mainPath = path.join(dist, 'js', 'main.js');
  if (fs.existsSync(mainPath)) {
    const code = fs.readFileSync(mainPath, 'utf8');
    try {
      dom.window.eval(code);
      console.log('main.js executed in jsdom');
    } catch (err) {
      console.error('Error executing main.js:', err);
      process.exit(3);
    }
  } else {
    console.error('dist/js/main.js not found'); process.exit(4);
  }

  // quick DOM checks
  const doc = dom.window.document;
  const missing = [];
  ['themeToggle','randomBtn','searchInput','postsGrid'].forEach(id => { if (!doc.getElementById(id)) missing.push(id); });
  console.log('Missing IDs in DOM:', missing);
  process.exit(0);
}

run();
