import importlib.util
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("fetch", root / "fetch.py")
fetch = importlib.util.module_from_spec(spec)
sys.modules["fetch"] = fetch
spec.loader.exec_module(fetch)


def test_public_assets_copied(tmp_path, monkeypatch):
    # Arrange: create a fake public/static directory with a file
    public_static = tmp_path / "public" / "static"
    public_static.mkdir(parents=True)
    (public_static / "styles.css").write_text("body{}", encoding="utf-8")

    # Use the temporary directory as working directory
    monkeypatch.chdir(tmp_path)
    fetch.DIST_DIR = tmp_path / "dist"

    # Act
    copied = fetch.ensure_dist()

    # Assert: assets were copied from public -> dist/static
    assert copied == "public"
    assert (fetch.DIST_DIR / "static" / "styles.css").read_text() == "body{}"
