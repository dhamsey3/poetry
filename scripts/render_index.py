#!/usr/bin/env python3
"""Render index.html from the Jinja2 template."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, List, Mapping, MutableMapping, Optional

from jinja2 import Environment, FileSystemLoader, select_autoescape


REPO_ROOT = Path(__file__).resolve().parent.parent
TEMPLATE_NAME = "index.html.j2"
DATA_PATH = REPO_ROOT / "data" / "posts.json"
OUTPUT_PATH = REPO_ROOT / "index.html"
AUTOGEN_BANNER = "<!-- AUTO-GENERATED from index.html.j2. Edit the .j2 file. -->\n"


DateInput = Optional[str]
Post = MutableMapping[str, object]


def load_posts() -> List[Post]:
    if not DATA_PATH.exists():
        return []

    try:
        with DATA_PATH.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return []

    posts: Iterable[Post]
    if isinstance(payload, list):
        posts = payload  # type: ignore[assignment]
    elif isinstance(payload, Mapping):
        for key in ("posts", "items", "data"):
            value = payload.get(key)
            if isinstance(value, list):
                posts = value  # type: ignore[assignment]
                break
        else:
            posts = []
    else:
        posts = []

    # Ensure we have a mutable copy per post for further augmentation.
    return [dict(post) for post in posts]


def parse_date(value: DateInput) -> Optional[datetime]:
    if not value or not isinstance(value, str):
        return None

    candidate = value.strip()
    if not candidate:
        return None

    # Attempt ISO-8601 parsing with optional trailing Z.
    iso_candidate = candidate
    if iso_candidate.endswith("Z"):
        iso_candidate = iso_candidate[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(iso_candidate)
    except ValueError:
        pass

    # Try a few common feed formats.
    date_formats = (
        "%a, %d %b %Y %H:%M:%S %z",  # RSS/Atom
        "%Y-%m-%d %H:%M:%S%z",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
        "%Y/%m/%d",
        "%m/%d/%Y",
    )
    for fmt in date_formats:
        try:
            return datetime.strptime(candidate, fmt)
        except ValueError:
            continue

    return None


def decorate_posts(posts: List[Post]) -> None:
    for post in posts:
        date_value = None
        for key in ("date", "pubDate", "published_at", "pubdate"):
            raw = post.get(key)
            if isinstance(raw, str) and raw.strip():
                date_value = raw
                break
        dt = parse_date(date_value)
        if dt is not None:
            sort_dt = dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
            post["_sort_ts"] = sort_dt.timestamp()
            post["date_human"] = sort_dt.strftime("%b %d, %Y")
        else:
            post["_sort_ts"] = float("-inf")
            post["date_human"] = ""

    posts.sort(key=lambda item: item.get("_sort_ts", float("-inf")), reverse=True)
    for post in posts:
        post.pop("_sort_ts", None)



def render(posts: List[Post]) -> str:
    env = Environment(
        loader=FileSystemLoader(str(REPO_ROOT)),
        autoescape=select_autoescape(["html", "xml"]),
    )
    template = env.get_template(TEMPLATE_NAME)
    return template.render(
        posts=posts,
        generated_at=datetime.now(timezone.utc),
        public_url="",
        feed_url="https://versesvibez.substack.com/feed",
        static_base="./static/",
        static_public_base=None,
        featured_ebook=None,
    )



def main() -> None:
    posts = load_posts()
    decorate_posts(posts)
    html = render(posts)
    OUTPUT_PATH.write_text(AUTOGEN_BANNER + html, encoding="utf-8")


if __name__ == "__main__":
    main()
