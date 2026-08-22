"""Writes a synthetic city into the cache, for looking at the scene.

The renderer is the hard thing to check by reading code: whether windows face
outward, whether a small file really gets a short building, whether anything
stands in the river. Analysing a real repository needs network and an API key,
so this fabricates a plausible one -- a spread of directories, roles and line
counts wide enough to exercise every archetype -- and writes it to the cache
under a stable key.

    .venv/Scripts/python -m tools.seed_demo_city [file-count]

Then open the city from the "recent" row on the landing page.
"""
from __future__ import annotations

import random
import sys

from app.services.city import build_city
from app.services.jobs import cache_key, cache_write
from app.services.selector import FileInfo

DIRECTORIES = [
    ("src/api", "api", ".py"),
    ("src/core", "business-logic", ".py"),
    ("src/models", "data-model", ".py"),
    ("src/ui", "ui", ".tsx"),
    ("src/styles", "styling", ".css"),
    ("src/auth", "business-logic", ".py"),
    ("tests", "test", ".py"),
    ("docs", "docs", ".md"),
    ("infra", "infra", ".tf"),
    ("scripts", "script", ".sh"),
    ("config", "config", ".yml"),
    (".", "entrypoint", ".py"),
]

LANDMARKS = ["README.md", "Dockerfile", "package.json", "Makefile", ".gitignore"]


def main(count: int = 120) -> None:
    random.seed(20260822)
    files: list[FileInfo] = []
    descriptions: dict[str, dict[str, object]] = {}
    loc_by_path: dict[str, int] = {}

    def add(path: str, role: str, loc: int, importance: int) -> None:
        files.append(
            FileInfo(
                path=path,
                name=path.rsplit("/", 1)[-1],
                ext="." + path.rsplit(".", 1)[-1] if "." in path else "",
                directory=path.rsplit("/", 1)[0] if "/" in path else ".",
                size=loc * 38,
                depth=path.count("/"),
                score=importance / 10,
                loc=loc,
                is_landmark=path in LANDMARKS,
            )
        )
        descriptions[path] = {
            "role": role,
            "importance": importance,
            "headline": f"{loc} lines",
            "summary": f"A {role} file of {loc} lines.",
        }
        loc_by_path[path] = loc

    for name in LANDMARKS:
        add(name, "docs" if name.endswith(".md") else "config",
            random.randint(20, 400), random.randint(4, 9))

    for i in range(count - len(LANDMARKS)):
        directory, role, ext = DIRECTORIES[i % len(DIRECTORIES)]
        path = f"{directory}/mod_{i:03d}{ext}" if directory != "." else f"mod_{i:03d}{ext}"
        # A long tail: most files small, a handful very large. This is what
        # makes the height ramp visible at a glance.
        loc = max(3, int(random.lognormvariate(4.3, 1.35)))
        add(path, role, loc, random.randint(1, 9))

    city = build_city(
        slug="demo/repo-city",
        html_url="https://github.com/demo/repo-city",
        branch="main",
        meta={"name": "repo-city", "description": "Synthetic city for checking the renderer.",
              "stargazers_count": 1234, "forks_count": 56, "open_issues_count": 7,
              "topics": ["demo"], "pushed_at": "2026-08-22T00:00:00Z"},
        project={"districts": [], "summary": "A fabricated repository."},
        files=files,
        descriptions=descriptions,
        loc_by_path=loc_by_path,
        languages={"Python": 60, "TypeScript": 30, "CSS": 10},
        stats_extra={},
    )

    key = cache_key("demo/repo-city", f"synthetic-{count}")
    cache_write(key, city)
    heights = sorted((b["loc"], b["height"]) for b in city["buildings"])
    print(f"wrote {key}")
    print(f"  {len(city['buildings'])} buildings, bounds {city['bounds']}")
    print(f"  shortest: {heights[0][1]:.1f} units at {heights[0][0]} loc")
    print(f"  tallest:  {heights[-1][1]:.1f} units at {heights[-1][0]} loc")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 120)
