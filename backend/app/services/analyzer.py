"""Claude-powered analysis: one project brief plus per-file explanations.

Every LLM call here uses structured outputs, so the pipeline downstream can
treat the result as data instead of parsing prose. When no API key is present
(or a call fails) we fall back to heuristic descriptions -- the city still
renders, just with shallower text, which keeps the demo alive.
"""
from __future__ import annotations

import asyncio
import json
import os
from typing import Any, Awaitable, Callable

from ..config import settings
from . import tech
from .llm import LLM, make_llm
from .selector import FileInfo

Progress = Callable[[str, float], Awaitable[None]]

ROLES = [
    "entrypoint", "ui", "api", "business-logic", "data-model", "config",
    "build", "test", "docs", "script", "styling", "infra", "other",
]

FILE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "files": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "headline": {
                        "type": "string",
                        "description": "Under 60 characters. What this file IS.",
                    },
                    "summary": {
                        "type": "string",
                        "description": "1-2 sentences for a hover card.",
                    },
                    "detail": {
                        "type": "string",
                        "description": "2-4 sentences: responsibilities, notable "
                                       "functions, how it fits the system.",
                    },
                    "role": {"type": "string", "enum": ROLES},
                    "tags": {"type": "array", "items": {"type": "string"}},
                    "key_symbols": {"type": "array", "items": {"type": "string"}},
                    "connects_to": {"type": "array", "items": {"type": "string"}},
                    "importance": {"type": "integer", "minimum": 1, "maximum": 10},
                },
                "required": [
                    "path", "headline", "summary", "detail", "role",
                    "tags", "key_symbols", "connects_to", "importance",
                ],
                "additionalProperties": False,
            },
        }
    },
    "required": ["files"],
    "additionalProperties": False,
}

PROJECT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "tagline": {"type": "string", "description": "One line, under 90 characters."},
        "overview": {
            "type": "string",
            "description": "4-7 sentences: what the project does, who it is for, "
                           "and what makes it interesting.",
        },
        "architecture": {
            "type": "string",
            "description": "A paragraph on how the pieces fit together.",
        },
        "tech_stack": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "slug": {
                        "type": "string",
                        "description": "devicon slug, e.g. react, python, docker. "
                                       "Empty string if none fits.",
                    },
                    "role": {"type": "string", "description": "Why it is used here."},
                },
                "required": ["name", "slug", "role"],
                "additionalProperties": False,
            },
        },
        "highlights": {"type": "array", "items": {"type": "string"}},
        "entry_points": {"type": "array", "items": {"type": "string"}},
        "districts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "name": {"type": "string", "description": "A short district name."},
                    "purpose": {"type": "string", "description": "1-2 sentences."},
                },
                "required": ["path", "name", "purpose"],
                "additionalProperties": False,
            },
        },
        "how_it_works": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "step": {"type": "string"},
                    "detail": {"type": "string"},
                },
                "required": ["step", "detail"],
                "additionalProperties": False,
            },
        },
        "getting_started": {"type": "string"},
    },
    "required": [
        "tagline", "overview", "architecture", "tech_stack", "highlights",
        "entry_points", "districts", "how_it_works", "getting_started",
    ],
    "additionalProperties": False,
}

PROJECT_SYSTEM = (
    "You are a staff engineer giving a newcomer a guided tour of an unfamiliar "
    "repository. You are precise, concrete and never invent features that the "
    "evidence does not support. If something is unclear from the material, say "
    "what it most likely is and keep it brief."
)

FILE_SYSTEM = (
    "You explain individual source files to a developer seeing the repository "
    "for the first time. Be concrete: name the real functions, classes, routes "
    "and exports you can see. Never pad with filler like 'this file contains "
    "code'. If a file is trivial, say so in one short sentence. Write for a "
    "hover card, so lead with the single most useful fact."
)


class Analyzer:
    """Turns repository material into descriptions, whichever model is behind it."""

    def __init__(self, client: LLM | None = None) -> None:
        self._llm = client or make_llm()
        self.enabled = self._llm.enabled

    @property
    def provider(self) -> str:
        return self._llm.provider

    @property
    def model(self) -> str:
        return self._llm.model

    @property
    def calls(self) -> int:
        return self._llm.calls

    @property
    def input_tokens(self) -> int:
        return self._llm.input_tokens

    @property
    def output_tokens(self) -> int:
        return self._llm.output_tokens

    @property
    def errors(self) -> list[str]:
        return self._llm.errors

    @property
    def throttled_seconds(self) -> float:
        return getattr(self._llm, "throttled_seconds", 0.0)

    async def close(self) -> None:
        await self._llm.close()

    async def _structured(
        self,
        system: str,
        prompt: str,
        schema: dict[str, Any],
        name: str,
        effort: str,
        kind: str = "files",
    ) -> dict[str, Any] | None:
        return await self._llm.structured(system, prompt, schema, name, effort, kind)

    # ----------------------------------------------------------------- project

    async def project(
        self,
        slug: str,
        meta: dict[str, Any],
        readme: str,
        manifests: dict[str, str],
        tree_outline: str,
        languages: dict[str, int],
    ) -> dict[str, Any]:
        if not self.enabled:
            return heuristic_project(slug, meta, readme, manifests, languages)

        manifest_blob = "\n\n".join(
            f"--- {path} ---\n{content[:2500]}" for path, content in manifests.items()
        )
        prompt = (
            f"Repository: {slug}\n"
            f"GitHub description: {meta.get('description') or '(none)'}\n"
            f"Primary language: {meta.get('language') or 'unknown'}\n"
            f"Stars: {meta.get('stargazers_count', 0)} | "
            f"Topics: {', '.join(meta.get('topics') or []) or '(none)'}\n"
            f"Language bytes: {json.dumps(languages)}\n\n"
            f"=== README (truncated) ===\n{readme[:14000] or '(no README)'}\n\n"
            f"=== Dependency manifests ===\n{manifest_blob or '(none found)'}\n\n"
            f"=== Directory outline (file counts) ===\n{tree_outline}\n\n"
            "Write the visitor briefing for this repository. It is shown at the "
            "entrance of a 3D city where every building is a file and every "
            "district is a directory.\n"
            "- 'districts' must cover the top-level directories listed in the "
            "outline, using their exact paths.\n"
            "- 'tech_stack' slugs must be real devicon slugs (react, python, "
            "fastapi, docker, postgresql, ...) or an empty string.\n"
            "- 'how_it_works' should trace the main runtime path in 3-6 steps."
        )
        result = await self._structured(
            PROJECT_SYSTEM, prompt, PROJECT_SCHEMA, "project_brief", settings.project_effort,
            kind="project"
        )
        if result is None:
            return heuristic_project(slug, meta, readme, manifests, languages)
        result["ai"] = True
        return result

    # ------------------------------------------------------------------- files

    async def files(
        self,
        project_context: str,
        batches: list[list[tuple[FileInfo, str]]],
        progress: Progress | None = None,
    ) -> dict[str, dict[str, Any]]:
        """Analyze batches of files concurrently; returns path -> description."""
        out: dict[str, dict[str, Any]] = {}
        if not batches:
            return out

        if not self.enabled:
            for batch in batches:
                for info, _ in batch:
                    out[info.path] = heuristic_file(info)
            return out

        semaphore = asyncio.Semaphore(settings.max_concurrency)
        done = 0
        total = len(batches)
        lock = asyncio.Lock()

        async def run(batch: list[tuple[FileInfo, str]]) -> None:
            nonlocal done
            async with semaphore:
                result = await self._one_batch(project_context, batch)
            async with lock:
                out.update(result)
                done += 1
                if progress:
                    await progress(
                        f"Explaining files ({done}/{total} batches)", 0.35 + 0.55 * done / total
                    )

        await asyncio.gather(*(run(batch) for batch in batches))
        return out

    async def _one_batch(
        self, project_context: str, batch: list[tuple[FileInfo, str]]
    ) -> dict[str, dict[str, Any]]:
        blocks = []
        for info, content in batch:
            blocks.append(
                f"--- FILE: {info.path} ({info.size} bytes, "
                f"{tech.detect(info.path).language}) ---\n{content}"
            )
        prompt = (
            f"{project_context}\n\n"
            "Explain each of the following files. Return one entry per file, "
            "using the exact path given.\n\n" + "\n\n".join(blocks)
        )
        result = await self._structured(
            FILE_SYSTEM, prompt, FILE_SCHEMA, "file_descriptions", settings.file_effort
        )
        if result is None:
            return {info.path: heuristic_file(info) for info, _ in batch}

        by_path: dict[str, dict[str, Any]] = {}
        for item in result.get("files", []):
            item["ai"] = True
            by_path[item["path"]] = item

        # A path the model renamed or dropped still needs a description.
        for info, _ in batch:
            by_path.setdefault(info.path, heuristic_file(info))
        return by_path


# ------------------------------------------------------------------ fallbacks

_ROLE_BY_HINT = [
    ("test", "test"), ("spec", "test"), ("docs", "docs"), (".md", "docs"),
    ("config", "config"), (".json", "config"), (".yml", "config"), (".yaml", "config"),
    (".toml", "config"), ("dockerfile", "infra"), ("k8s", "infra"), ("terraform", "infra"),
    (".css", "styling"), (".scss", "styling"), ("component", "ui"), (".tsx", "ui"),
    (".jsx", "ui"), ("api", "api"), ("route", "api"), ("view", "api"),
    ("model", "data-model"), ("schema", "data-model"), ("migration", "data-model"),
    ("script", "script"), (".sh", "script"),
]


def _guess_role(path: str) -> str:
    lower = path.lower()
    stem = os.path.splitext(os.path.basename(lower))[0]
    if stem in {"main", "index", "app", "server", "__main__", "cli"}:
        return "entrypoint"
    for hint, role in _ROLE_BY_HINT:
        if hint in lower:
            return role
    return "business-logic"


def heuristic_file(info: FileInfo) -> dict[str, Any]:
    """Structure-only description used when the LLM is unavailable."""
    detected = tech.detect(info.path)
    role = _guess_role(info.path)
    where = info.directory if info.directory != "." else "the project root"
    return {
        "path": info.path,
        "headline": f"{detected.language} file in {where}",
        "summary": (
            f"A {detected.language} file ({info.size:,} bytes) living in {where}. "
            "Add GROQ_API_KEY to backend/.env for a real explanation."
        ),
        "detail": (
            f"{info.name} sits in {where} and looks like a {role.replace('-', ' ')} "
            f"file based on its name, location and extension. This description is "
            f"structural only -- the AI narrator is offline because no model "
            f"API key is configured."
        ),
        "role": role,
        "tags": [detected.language, role],
        "key_symbols": [],
        "connects_to": [],
        "importance": max(1, min(10, round(info.score * 10))),
        "ai": False,
    }


def heuristic_project(
    slug: str,
    meta: dict[str, Any],
    readme: str,
    manifests: dict[str, str],
    languages: dict[str, int],
) -> dict[str, Any]:
    description = meta.get("description") or "No description provided on GitHub."
    first_para = ""
    for block in readme.split("\n\n"):
        cleaned = block.strip()
        if cleaned and not cleaned.startswith(("#", "!", "[", "<")) and len(cleaned) > 60:
            first_para = cleaned[:600]
            break
    top_languages = sorted(languages.items(), key=lambda kv: -kv[1])[:6]
    return {
        "tagline": description[:90],
        "overview": (
            f"{slug} -- {description} "
            + (first_para or "")
            + " (Structural preview: add GROQ_API_KEY to backend/.env to have "
              "the model write the full briefing.)"
        ),
        "architecture": (
            "Directory layout drives this map: each top-level folder became a "
            "district and each file a building sized by its line count."
        ),
        "tech_stack": [
            {"name": name, "slug": tech.slug_for_language(name), "role": "Language in the repo"}
            for name, _ in top_languages
        ]
        + [
            {"name": tech.pretty_name(slug), "slug": slug, "role": "Found in the manifests"}
            for slug in tech.dependency_logos(manifests)
        ],
        "highlights": [f"{name}: {count:,} bytes" for name, count in top_languages],
        "entry_points": [p for p in manifests if p.lower() in {"main.py", "index.js"}],
        "districts": [],
        "how_it_works": [],
        "getting_started": "See the repository README.",
        "ai": False,
    }
