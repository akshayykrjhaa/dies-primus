"""The end-to-end job: GitHub URL in, city JSON out."""
from __future__ import annotations

import asyncio
from typing import Any

from ..config import settings
from . import city as city_builder
from . import tech
from .analyzer import Analyzer
from .github import GitHubClient, GitHubError, parse_repo_url
from .jobs import Job, cache_key, cache_read, cache_write
from .selector import FileInfo, collect, pick_buildings, pick_for_llm
from .sketch import sketch

MANIFEST_NAMES = {
    "package.json", "requirements.txt", "pyproject.toml", "setup.py", "cargo.toml",
    "go.mod", "gemfile", "composer.json", "pom.xml", "build.gradle", "pubspec.yaml",
    "docker-compose.yml", "docker-compose.yaml", "dockerfile", "makefile",
}


def _tree_outline(files: list[FileInfo], limit: int = 45) -> str:
    counts: dict[str, int] = {}
    for file in files:
        top = file.path.split("/")[0] if "/" in file.path else "(root)"
        counts[top] = counts.get(top, 0) + 1
    rows = sorted(counts.items(), key=lambda kv: -kv[1])[:limit]
    return "\n".join(f"{name}/  -> {count} files" for name, count in rows)


def _sample_paths(files: list[FileInfo], limit: int = 60) -> str:
    top = sorted(files, key=lambda f: -f.score)[:limit]
    return "\n".join(f"{f.path} ({f.size} bytes)" for f in top)


async def run_analysis(job: Job, force: bool = False) -> dict[str, Any]:
    """Executes one analysis job, pushing progress into the job as it goes."""
    analyzer = Analyzer()
    try:
        await job.update("Reading the repository URL", 0.02)
        ref = parse_repo_url(job.repo_url)

        async with GitHubClient() as github:
            await job.update(f"Fetching {ref.slug} from GitHub", 0.06)
            snapshot = await github.snapshot(ref)

            key = cache_key(ref.slug, snapshot.commit_sha)
            if not force:
                cached = cache_read(key)
                if cached:
                    await job.update("Loaded a cached city", 1.0)
                    job.finish(cached)
                    return cached

            await job.update("Surveying the file tree", 0.12)
            all_files = collect(snapshot.tree)
            if not all_files:
                raise GitHubError(
                    "No readable source files found in this repository."
                )
            building_files = pick_buildings(all_files, settings.max_buildings)
            llm_files = pick_for_llm(building_files, settings.max_llm_files)

            await job.update(
                f"Downloading {len(llm_files)} key files", 0.18
            )
            manifest_paths = [
                f.path for f in all_files
                if f.name.lower() in MANIFEST_NAMES and f.depth <= 2
            ][:10]
            wanted = list({f.path for f in llm_files} | set(manifest_paths))
            contents = await github.fetch_many(snapshot.ref, wanted, 20000)

        manifests = {path: contents[path] for path in manifest_paths if path in contents}
        loc_by_path = {
            path: max(1, text.count("\n") + 1) for path, text in contents.items()
        }

        await job.update("Asking the model to read the code", 0.3)

        outline = _tree_outline(all_files)
        outline_inline = ", ".join(
            line.split("  ->")[0] for line in outline.splitlines()[:12]
        )
        # This preamble is resent with every batch, so it is deliberately
        # short. On a per-minute token budget a fat prefix costs more than the
        # files it is meant to give context to.
        light_context = (
            f"Repository: {ref.slug}\n"
            f"Description: {snapshot.meta.get('description') or '(none)'}\n"
            f"README opening:\n{snapshot.readme[:600]}\n"
            f"Top-level layout: {outline_inline}\n"
        )

        batches: list[list[tuple[FileInfo, str]]] = []
        current: list[tuple[FileInfo, str]] = []
        for file in llm_files:
            text = contents.get(file.path)
            if not text:
                continue
            # Compress to signatures + structure: on a metered API this is the
            # difference between describing 8 files a minute and 30.
            current.append((file, sketch(file.path, text, settings.file_char_budget)))
            if len(current) >= settings.batch_size:
                batches.append(current)
                current = []
        if current:
            batches.append(current)

        project, descriptions = await asyncio.gather(
            analyzer.project(
                ref.slug,
                snapshot.meta,
                snapshot.readme,
                manifests,
                outline,
                snapshot.languages,
            ),
            analyzer.files(light_context, batches, progress=job.update),
        )

        # Files that never reached the model still need something to say.
        from .analyzer import heuristic_file

        for file in building_files:
            descriptions.setdefault(file.path, heuristic_file(file))

        await job.update("Laying out the city", 0.93)
        result = city_builder.build_city(
            slug=ref.slug,
            html_url=snapshot.html_url,
            branch=snapshot.ref.ref or snapshot.default_branch,
            meta=snapshot.meta,
            project=project,
            files=building_files,
            descriptions=descriptions,
            loc_by_path=loc_by_path,
            languages=snapshot.languages,
            stats_extra={
                "filesInRepo": len(snapshot.tree),
                "filesConsidered": len(all_files),
                "filesReadByAI": len(llm_files) if analyzer.enabled else 0,
                "aiEnabled": analyzer.enabled,
                "provider": analyzer.provider,
                "model": analyzer.model if analyzer.enabled else "",
                "llmCalls": analyzer.calls,
                "inputTokens": analyzer.input_tokens,
                "outputTokens": analyzer.output_tokens,
                "treeTruncated": snapshot.truncated,
                "warnings": analyzer.errors[:5],
                "throttledSeconds": round(getattr(analyzer, "throttled_seconds", 0.0), 1),
                "seedTech": tech.dependency_logos(manifests),
            },
        )
        cache_write(key, result)
        job.finish(result)
        return result

    except GitHubError as exc:
        job.fail(str(exc))
        raise
    except Exception as exc:  # noqa: BLE001 - surfaced to the UI verbatim
        job.fail(f"{type(exc).__name__}: {exc}")
        raise
    finally:
        await analyzer.close()
