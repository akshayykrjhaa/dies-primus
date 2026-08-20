"""Compresses a source file into the parts that actually explain it.

Sending whole files is wasteful: what a reader needs is the imports, the
declarations and a little body, not 400 lines of implementation. On a metered
API this is the difference between describing 8 files a minute and 30.
"""
from __future__ import annotations

import re

# Lines that carry structure across the languages this app is likely to meet.
SIGNAL = re.compile(
    r"^\s*("
    r"import\b|from\s+\S+\s+import|#include|use\s+\w|require\s*\(|package\s+\w"
    r"|export\b|module\.exports|declare\b"
    r"|(async\s+)?(export\s+)?(default\s+)?function\b"
    r"|(public|private|protected|internal|static|final|abstract)\s"
    r"|class\b|interface\b|struct\b|enum\b|trait\b|impl\b|type\s+\w+\s*="
    r"|def\s|fn\s|func\s|sub\s|proc\s"
    r"|const\s+\w+\s*[:=]|let\s+\w+\s*[:=]|var\s+\w+\s*[:=]"
    r"|@\w+|\[\w+\]|app\.\w+\(|router\.\w+\(|@app\.|@router\."
    r"|CREATE\s+TABLE|ALTER\s+TABLE"
    r")",
    re.IGNORECASE,
)

COMMENT_START = ("#", "//", "/*", "*", '"""', "'''", "<!--", "--")


def sketch(path: str, content: str, budget: int = 1700) -> str:
    """A compact view of one file, at most roughly `budget` characters."""
    if len(content) <= budget:
        return content

    lines = content.splitlines()
    lower = path.lower()

    # Documentation and config are meaningful as-is; just take the head.
    if lower.endswith((".md", ".mdx", ".rst", ".txt", ".json", ".yml", ".yaml", ".toml", ".ini")):
        return _head(lines, budget)

    kept: list[str] = []
    used = 0
    header_done = False

    # Always keep the first few lines: licence banners, shebangs, module docs.
    for line in lines[:8]:
        if line.strip():
            kept.append(line)
            used += len(line) + 1

    for index, line in enumerate(lines[8:], start=8):
        stripped = line.strip()
        if not stripped:
            continue
        is_signal = bool(SIGNAL.match(line))
        is_doc = stripped.startswith(COMMENT_START) and len(stripped) > 12

        if is_signal or (is_doc and not header_done):
            if used + len(line) > budget:
                kept.append(f"... [{len(lines) - index} more lines]")
                break
            kept.append(line)
            used += len(line) + 1
            if is_signal:
                header_done = True

    if len(kept) < 6:
        return _head(lines, budget)
    return "\n".join(kept)


def _head(lines: list[str], budget: int) -> str:
    out: list[str] = []
    used = 0
    for index, line in enumerate(lines):
        if used + len(line) > budget:
            out.append(f"... [{len(lines) - index} more lines]")
            break
        out.append(line)
        used += len(line) + 1
    return "\n".join(out)
