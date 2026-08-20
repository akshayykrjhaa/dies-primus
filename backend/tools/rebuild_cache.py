"""Re-runs cached cities through the current generator.

The expensive half of an analysis is the model pass; the layout is cheap and
deterministic. When the city generator changes shape -- new archetypes, a new
road network -- this rebuilds every cached city from the descriptions already
on disk, so nothing has to be re-analyzed and no tokens are spent.

    .venv/Scripts/python -m tools.rebuild_cache
"""
from __future__ import annotations

import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import settings  # noqa: E402
from app.services import city as city_builder  # noqa: E402
from app.services.selector import FileInfo  # noqa: E402


def rebuild(path: str) -> tuple[str, int, int]:
    with open(path, encoding="utf-8") as handle:
        old = json.load(handle)

    files: list[FileInfo] = []
    descriptions: dict[str, dict] = {}
    loc_by_path: dict[str, int] = {}

    for building in old.get("buildings", []):
        directory = "/".join(building["path"].split("/")[:-1]) or "."
        files.append(
            FileInfo(
                path=building["path"],
                name=building["name"],
                ext=building["ext"],
                directory=directory,
                size=building.get("bytes", 0),
                depth=building["path"].count("/"),
                score=building.get("importance", 5) / 10,
                loc=building.get("loc", 1),
                is_landmark=building.get("isLandmark", False),
            )
        )
        descriptions[building["path"]] = {
            "role": building.get("role", "other"),
            "importance": building.get("importance", 5),
            "headline": building.get("headline", ""),
            "summary": building.get("summary", ""),
            "detail": building.get("detail", ""),
            "tags": building.get("tags", []),
            "key_symbols": building.get("keySymbols", []),
            "connects_to": building.get("connectsTo", []),
            "ai": building.get("ai", False),
        }
        loc_by_path[building["path"]] = building.get("loc", 1)

    if not files:
        return old.get("repo", {}).get("slug", path), 0, 0

    stats = old.get("stats", {})
    carried = {
        key: stats[key]
        for key in (
            "filesInRepo", "filesConsidered", "filesReadByAI", "aiEnabled",
            "provider", "model", "llmCalls", "inputTokens", "outputTokens",
            "treeTruncated", "warnings", "seedTech", "throttledSeconds",
        )
        if key in stats
    }

    repo = old["repo"]
    fresh = city_builder.build_city(
        slug=repo["slug"],
        html_url=repo["url"],
        branch=repo.get("branch", "main"),
        meta={
            "name": repo.get("name"),
            "description": repo.get("description"),
            "stargazers_count": repo.get("stars", 0),
            "forks_count": repo.get("forks", 0),
            "open_issues_count": repo.get("openIssues", 0),
            "license": {"spdx_id": repo.get("license", "")},
            "topics": repo.get("topics", []),
            "homepage": repo.get("homepage", ""),
            "pushed_at": repo.get("pushedAt", ""),
        },
        project=old.get("project", {}),
        files=files,
        descriptions=descriptions,
        loc_by_path=loc_by_path,
        languages=stats.get("repoLanguages", {}),
        stats_extra=carried,
    )

    with open(path, "w", encoding="utf-8") as handle:
        json.dump(fresh, handle)

    return repo["slug"], len(fresh["buildings"]), len(fresh["props"])


def main() -> int:
    paths = sorted(glob.glob(str(settings.cache_dir / "*.json")))
    if not paths:
        print("No cached cities to rebuild.")
        return 0
    for path in paths:
        slug, buildings, props = rebuild(path)
        print(f"  rebuilt {slug:<45} {buildings:>4} buildings, {props:>4} props")
    print(f"\n{len(paths)} cities rebuilt with no model calls.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
