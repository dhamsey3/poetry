import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _prepare_featured_source() -> str:
    template = (ROOT / "index.html.j2").read_text(encoding="utf-8")
    marker = "prepareFeatured(){"
    start = template.index(marker)
    idx = start + len(marker)
    depth = 1
    while depth and idx < len(template):
        char = template[idx]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
        idx += 1
    method = template[start:idx]
    return "function " + method


def render_poem_html(poem: str) -> str:
    method_src = _prepare_featured_source()
    script = f"""
const escapeHtml = (str = '') => String(str)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');
const FEATURED_EBOOK = {{}};
{method_src}
const featured = prepareFeatured();
const html = featured.poemHtml({json.dumps(poem)});
console.log(JSON.stringify({{ html }}));
"""
    result = subprocess.run(
        ["node", "-e", script],
        capture_output=True,
        check=True,
        text=True,
    )
    return json.loads(result.stdout)["html"]


def test_poem_html_preserves_indentation():
    poem = "\n  Leading spark\n\tTabbed echo\nStill light\n"
    html = render_poem_html(poem)
    assert "&nbsp;&nbsp;Leading spark" in html
    assert "&nbsp;&nbsp;&nbsp;&nbsp;Tabbed echo" in html
    assert "Still light" in html


def test_poem_html_handles_blank_stanza_and_indent():
    poem = "\nFirst lantern\n\n\nSecond lantern\n  lingering glow\n"
    html = render_poem_html(poem)
    assert "<p>First lantern</p>" in html
    assert "<p><br></p>" in html
    assert "Second lantern" in html
    assert "&nbsp;&nbsp;lingering glow" in html


def test_poem_html_starts_with_indentation_without_padding_newline():
    poem = "  Kindling path\nEmber follows\n"
    html = render_poem_html(poem)
    assert html.startswith("<p>&nbsp;&nbsp;Kindling path<br>Ember follows</p>")


def test_poem_html_leading_blank_stanza_with_indentation():
    poem = "\n  \nLighthouse hum\n"
    html = render_poem_html(poem)
    assert html.startswith("<p><br></p><p>Lighthouse hum</p>")
