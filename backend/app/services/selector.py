"""Decides which files become buildings, and which ones Claude reads.

A repo can hold 30k files; a city that renders and reads well holds a few
hundred. This module does the triage with cheap heuristics so the expensive
LLM budget is spent on the files that actually explain the project.
"""
from __future__ import annotations

import os
from dataclasses import dataclass

from .github import TreeEntry

SKIP_DIRS = {
    "node_modules", ".git", ".github/ISSUE_TEMPLATE", "dist", "build", "out",
    "vendor", "venv", ".venv", "env", "__pycache__", ".next", ".nuxt", ".svelte-kit",
    "target", "coverage", ".idea", ".vscode", "site-packages", "bower_components",
    ".cache", ".pytest_cache", ".mypy_cache", ".gradle", "Pods", "DerivedData",
    "third_party", "vendored", ".terraform", "bin", "obj", ".tox", "htmlcov",
}

SKIP_EXTS = {
    # binaries and media -- nothing to read, nothing to explain
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".icns", ".tiff",
    ".mp3", ".mp4", ".mov", ".avi", ".webm", ".wav", ".ogg", ".flac",
    ".woff", ".woff2", ".ttf", ".otf", ".eot",
    ".zip", ".tar", ".gz", ".bz2", ".xz", ".7z", ".rar", ".jar", ".war",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".so", ".dll", ".dylib", ".exe", ".bin", ".o", ".a", ".class", ".pyc",
    ".pkl", ".pt", ".pth", ".onnx", ".h5", ".parquet", ".db", ".sqlite",
    ".svg", ".map", ".lock", ".log", ".min.js", ".min.css",
}

# Files that carry a lot of meaning regardless of size.
LANDMARK_NAMES = {
    "readme.md", "package.json", "pyproject.toml", "requirements.txt", "cargo.toml",
    "go.mod", "dockerfile", "docker-compose.yml", "docker-compose.yaml", "makefile",
    "main.py", "app.py", "server.py", "index.js", "index.ts", "main.go", "main.rs",
    "app.tsx", "app.jsx", "main.tsx", "main.ts", "cli.py", "manage.py", "setup.py",
    "schema.prisma", "next.config.js", "vite.config.ts", "settings.py", "urls.py",
}

ENTRY_STEMS = {"main", "index", "app", "server", "cli", "run", "__init__", "__main__", "core"}

MAX_FILE_BYTES = 400_000


@dataclass
class FileInfo:
    path: str
    name: str
    ext: str
    directory: str
    size: int
    depth: int
    score: float
    loc: int = 0            # estimated lines, refined once content is fetched
    is_landmark: bool = False


def _skipped(path: str) -> bool:
    parts = path.split("/")
    for part in parts[:-1]:
        if part in SKIP_DIRS:
            return True
    name = parts[-1].lower()
    if name.startswith("."):
        # keep meaningful dotfiles, drop editor/OS noise
        if name not in {".gitignore", ".env.example", ".dockerignore", ".eslintrc.json"}:
            return True
    if ".min." in name or name.endswith(".d.ts"):
        return True
    ext = os.path.splitext(name)[1]
    return ext in SKIP_EXTS


def _score(path: str, size: int) -> tuple[float, bool]:
    """Heuristic importance in roughly 0..1, plus a landmark flag."""
    lower = path.lower()
    name = os.path.basename(lower)
    stem = os.path.splitext(name)[0]
    depth = lower.count("/")

    score = 0.35
    landmark = False

    if name in LANDMARK_NAMES:
        score += 0.45
        landmark = True
    if stem in ENTRY_STEMS:
        score += 0.2
        if depth <= 2:
            landmark = True

    # Shallow files are usually the ones that define the project.
    score += max(0.0, 0.2 - 0.045 * depth)

    # Prefer substantial-but-readable files; huge generated blobs are noise.
    if 800 <= size <= 30_000:
        score += 0.15
    elif size > 120_000:
        score -= 0.2
    elif size < 120:
        score -= 0.15

    # Directory signals.
    for fragment, delta in (
        ("/test", -0.18), ("test/", -0.18), ("spec/", -0.15), ("__tests__", -0.18),
        ("/docs", -0.1), ("example", -0.12), ("fixture", -0.2), ("mock", -0.15),
        ("src/", 0.1), ("app/", 0.08), ("lib/", 0.06), ("api/", 0.08),
        ("core/", 0.08), ("services/", 0.07), ("components/", 0.05),
        ("models/", 0.07), ("routes/", 0.07), ("migrations/", -0.12),
        ("locales/", -0.25), ("i18n/", -0.2), ("assets/", -0.15),
    ):
        if fragment in lower:
            score += delta

    return max(0.02, min(1.0, score)), landmark


def collect(entries: list[TreeEntry]) -> list[FileInfo]:
    """Filter the raw tree down to files worth putting on the map."""
    files: list[FileInfo] = []
    for entry in entries:
        if entry.size > MAX_FILE_BYTES or _skipped(entry.path):
            continue
        score, landmark = _score(entry.path, entry.size)
        name = os.path.basename(entry.path)
        files.append(
            FileInfo(
                path=entry.path,
                name=name,
                ext=os.path.splitext(name)[1].lower(),
                directory=os.path.dirname(entry.path) or ".",
                size=entry.size,
                depth=entry.path.count("/"),
                score=score,
                loc=max(1, entry.size // 34),  # ~34 bytes per line, refined later
                is_landmark=landmark,
            )
        )
    return files


def pick_buildings(files: list[FileInfo], limit: int) -> list[FileInfo]:
    """Cap the city size while keeping every directory represented.

    Dropping whole folders would misrepresent the project, so each directory
    keeps its best file before the remaining slots go to the global ranking.
    """
    if len(files) <= limit:
        return files

    by_dir: dict[str, list[FileInfo]] = {}
    for file in files:
        by_dir.setdefault(file.directory, []).append(file)

    kept: list[FileInfo] = []
    seen: set[str] = set()
    for directory, group in by_dir.items():
        best = max(group, key=lambda f: f.score)
        kept.append(best)
        seen.add(best.path)
        if len(kept) >= limit:
            return kept

    rest = sorted(
        (f for f in files if f.path not in seen), key=lambda f: f.score, reverse=True
    )
    kept.extend(rest[: limit - len(kept)])
    return kept


def pick_for_llm(files: list[FileInfo], limit: int) -> list[FileInfo]:
    """The subset Claude actually reads, spread across the codebase.

    Round-robin across directories so the analysis covers the whole project
    instead of exhausting the budget inside one deep folder.
    """
    ranked = sorted(files, key=lambda f: f.score, reverse=True)
    if len(ranked) <= limit:
        return ranked

    buckets: dict[str, list[FileInfo]] = {}
    for file in ranked:
        buckets.setdefault(file.directory.split("/")[0], []).append(file)

    chosen: list[FileInfo] = []
    order = sorted(buckets, key=lambda k: -max(f.score for f in buckets[k]))
    index = 0
    while len(chosen) < limit and any(buckets.values()):
        key = order[index % len(order)]
        if buckets[key]:
            chosen.append(buckets[key].pop(0))
        index += 1
        if index > limit * 12:  # safety valve
            break
    return chosen[:limit]
