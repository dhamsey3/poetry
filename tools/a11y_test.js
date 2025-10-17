const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

(async () => {
  const dist = path.resolve(__dirname, '..', 'dist');
  const index = path.join(dist, 'index.html');
  if (!fs.existsSync(index)) { console.error('dist/index.html missing'); process.exit(2); }
  const html = fs.readFileSync(index, 'utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable' });
  dom.window.DOMPurify = { sanitize: s => s };
  // wait a bit for scripts
  await new Promise(r => setTimeout(r, 300));

  const { window } = dom;
  // expose globals for axe BEFORE requiring it
  global.window = window; global.document = window.document; global.Node = window.Node; global.HTMLElement = window.HTMLElement;
  // mock canvas getContext to avoid jsdom warning
  if (!window.HTMLCanvasElement.prototype.getContext) window.HTMLCanvasElement.prototype.getContext = () => null;
  const axe = require('axe-core');
  const result = await new Promise((resolve) => {
    axe.run(document, { reporter: 'v2' }, (err, res) => resolve(res));
  });
  if (result.violations && result.violations.length) {
    console.log('Accessibility violations:');
    result.violations.forEach(v => {
      console.log(v.id, v.impact, v.description);
      v.nodes.forEach(n => console.log(' -', n.html));
    });
    process.exit(1);
  }
  console.log('No accessibility violations found by axe-core (basic scan)');
  process.exit(0);
})();
