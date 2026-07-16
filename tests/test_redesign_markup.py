from pathlib import Path

import fetch


def _render(tmp_path, monkeypatch, **env):
    monkeypatch.setattr(fetch, "DIST_DIR", tmp_path)
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    fetch.render_index(
        "Torchborne",
        "https://example.com/feed",
        "https://example.com",
        "",
    )
    return (tmp_path / "index.html").read_text(encoding="utf-8")


def test_redesign_shell_contains_semantic_views(tmp_path, monkeypatch):
    html = _render(tmp_path, monkeypatch)

    for hook in (
        'id="homeView"',
        'id="readerView"',
        'id="aboutView"',
        'id="subscribeDialog"',
        'id="initialPostsData"',
        'id="appConfig"',
        'src="./static/app.js',
    ):
        assert hook in html

    assert "support.js" not in html
    assert "fortune-design-system" not in html
    assert 'class="particles"' not in html
    assert 'class="floating-shapes"' not in html


def test_shell_preserves_discovery_and_fallback_controls(tmp_path, monkeypatch):
    html = _render(tmp_path, monkeypatch)

    for hook in (
        'id="searchInput"',
        'id="moodFilters"',
        'id="tagFilters"',
        'id="postsGrid"',
        'id="resultSummary"',
        'id="loadMore"',
        'id="statusMessage"',
    ):
        assert hook in html

    assert "https://example.com/subscribe" in html
    assert "JavaScript is disabled" in html


def test_ebook_surface_remains_conditional(tmp_path, monkeypatch):
    without_ebook = _render(tmp_path, monkeypatch)
    assert 'id="ebookSpotlight"' not in without_ebook

    with_ebook = _render(
        tmp_path,
        monkeypatch,
        EBOOK_KINDLE_URL="https://www.amazon.com/dp/B012345678",
        EBOOK_TITLE="The Small Flame",
    )
    assert 'id="ebookSpotlight"' in with_ebook
    assert "The Small Flame" in with_ebook


def test_stylesheet_contains_accessible_responsive_contract():
    css = Path("public/static/styles.css").read_text(encoding="utf-8")
    for rule in (
        ":focus-visible",
        "prefers-reduced-motion",
        '[data-theme="dark"]',
        ".reader-view",
        ".subscribe-dialog",
        "@media (max-width: 640px)",
    ):
        assert rule in css

    assert ".particles" not in css
    assert ".floating-shapes" not in css
