"""Maps file paths to a language, a colour and a devicon logo slug.

The frontend renders logos from the devicon CDN using `icon_slug`, so the
slugs here must be real devicon names (https://devicon.dev).
"""
from __future__ import annotations

import os
from typing import NamedTuple


class Tech(NamedTuple):
    language: str
    color: str        # hex, drives the building colour
    icon_slug: str    # devicon slug, "" -> frontend falls back to a glyph


# extension -> (language, colour, devicon slug)
_BY_EXT: dict[str, Tech] = {
    ".py": Tech("Python", "#3572A5", "python"),
    ".ipynb": Tech("Jupyter", "#DA5B0B", "jupyter"),
    ".js": Tech("JavaScript", "#F1E05A", "javascript"),
    ".mjs": Tech("JavaScript", "#F1E05A", "javascript"),
    ".cjs": Tech("JavaScript", "#F1E05A", "javascript"),
    ".jsx": Tech("React", "#61DAFB", "react"),
    ".ts": Tech("TypeScript", "#3178C6", "typescript"),
    ".tsx": Tech("React TSX", "#61DAFB", "react"),
    ".vue": Tech("Vue", "#41B883", "vuejs"),
    ".svelte": Tech("Svelte", "#FF3E00", "svelte"),
    ".java": Tech("Java", "#B07219", "java"),
    ".kt": Tech("Kotlin", "#A97BFF", "kotlin"),
    ".kts": Tech("Kotlin", "#A97BFF", "kotlin"),
    ".go": Tech("Go", "#00ADD8", "go"),
    ".rs": Tech("Rust", "#DEA584", "rust"),
    ".rb": Tech("Ruby", "#701516", "ruby"),
    ".php": Tech("PHP", "#4F5D95", "php"),
    ".cs": Tech("C#", "#178600", "csharp"),
    ".c": Tech("C", "#555555", "c"),
    ".h": Tech("C header", "#555555", "c"),
    ".cpp": Tech("C++", "#F34B7D", "cplusplus"),
    ".cc": Tech("C++", "#F34B7D", "cplusplus"),
    ".hpp": Tech("C++ header", "#F34B7D", "cplusplus"),
    ".swift": Tech("Swift", "#F05138", "swift"),
    ".m": Tech("Objective-C", "#438EFF", "apple"),
    ".dart": Tech("Dart", "#00B4AB", "dart"),
    ".scala": Tech("Scala", "#C22D40", "scala"),
    ".ex": Tech("Elixir", "#6E4A7E", "elixir"),
    ".exs": Tech("Elixir", "#6E4A7E", "elixir"),
    ".erl": Tech("Erlang", "#B83998", "erlang"),
    ".hs": Tech("Haskell", "#5E5086", "haskell"),
    ".lua": Tech("Lua", "#000080", "lua"),
    ".r": Tech("R", "#198CE7", "r"),
    ".pl": Tech("Perl", "#0298C3", "perl"),
    ".sh": Tech("Shell", "#89E051", "bash"),
    ".bash": Tech("Shell", "#89E051", "bash"),
    ".zsh": Tech("Shell", "#89E051", "bash"),
    ".ps1": Tech("PowerShell", "#012456", "powershell"),
    ".sql": Tech("SQL", "#E38C00", "mysql"),
    ".html": Tech("HTML", "#E34C26", "html5"),
    ".htm": Tech("HTML", "#E34C26", "html5"),
    ".css": Tech("CSS", "#563D7C", "css3"),
    ".scss": Tech("Sass", "#CF649A", "sass"),
    ".sass": Tech("Sass", "#CF649A", "sass"),
    ".less": Tech("Less", "#1D365D", "less"),
    ".json": Tech("JSON", "#8892BF", "json"),
    ".yml": Tech("YAML", "#CB171E", "yaml"),
    ".yaml": Tech("YAML", "#CB171E", "yaml"),
    ".toml": Tech("TOML", "#9C4221", "toml"),
    ".xml": Tech("XML", "#0060AC", "xml"),
    ".md": Tech("Markdown", "#9CA3AF", "markdown"),
    ".mdx": Tech("MDX", "#9CA3AF", "markdown"),
    ".rst": Tech("reST", "#9CA3AF", "markdown"),
    ".txt": Tech("Text", "#9CA3AF", ""),
    ".graphql": Tech("GraphQL", "#E10098", "graphql"),
    ".gql": Tech("GraphQL", "#E10098", "graphql"),
    ".proto": Tech("Protobuf", "#4A90D9", "grpc"),
    ".tf": Tech("Terraform", "#7B42BC", "terraform"),
    ".sol": Tech("Solidity", "#AA6746", "solidity"),
    ".zig": Tech("Zig", "#EC915C", "zig"),
    ".astro": Tech("Astro", "#FF5D01", "astro"),
    ".prisma": Tech("Prisma", "#0C344B", "prisma"),
}

# Exact filenames win over extensions -- these are the recognisable landmarks
# of a repo and deserve their own logo.
_BY_NAME: dict[str, Tech] = {
    "dockerfile": Tech("Docker", "#2496ED", "docker"),
    "docker-compose.yml": Tech("Docker Compose", "#2496ED", "docker"),
    "docker-compose.yaml": Tech("Docker Compose", "#2496ED", "docker"),
    "package.json": Tech("npm manifest", "#CB3837", "npm"),
    "package-lock.json": Tech("npm lockfile", "#CB3837", "npm"),
    "pnpm-lock.yaml": Tech("pnpm lockfile", "#F69220", "pnpm"),
    "yarn.lock": Tech("Yarn lockfile", "#2C8EBB", "yarn"),
    "requirements.txt": Tech("Python deps", "#3572A5", "python"),
    "pyproject.toml": Tech("Python project", "#3572A5", "python"),
    "setup.py": Tech("Python packaging", "#3572A5", "python"),
    "pipfile": Tech("Pipenv", "#3572A5", "python"),
    "cargo.toml": Tech("Cargo manifest", "#DEA584", "rust"),
    "go.mod": Tech("Go module", "#00ADD8", "go"),
    "gemfile": Tech("Bundler", "#701516", "ruby"),
    "composer.json": Tech("Composer", "#4F5D95", "composer"),
    "pom.xml": Tech("Maven", "#B07219", "maven"),
    "build.gradle": Tech("Gradle", "#02303A", "gradle"),
    "makefile": Tech("Make", "#427819", "cmake"),
    "cmakelists.txt": Tech("CMake", "#427819", "cmake"),
    "readme.md": Tech("Readme", "#E5E7EB", "markdown"),
    "license": Tech("License", "#9CA3AF", ""),
    ".gitignore": Tech("Git config", "#F1502F", "git"),
    ".gitattributes": Tech("Git config", "#F1502F", "git"),
    "vite.config.ts": Tech("Vite", "#646CFF", "vitejs"),
    "vite.config.js": Tech("Vite", "#646CFF", "vitejs"),
    "webpack.config.js": Tech("Webpack", "#8DD6F9", "webpack"),
    "tsconfig.json": Tech("TypeScript config", "#3178C6", "typescript"),
    "tailwind.config.js": Tech("Tailwind", "#38BDF8", "tailwindcss"),
    "next.config.js": Tech("Next.js", "#E5E7EB", "nextjs"),
    "nginx.conf": Tech("Nginx", "#009639", "nginx"),
}

# Path fragment -> logo override, so a file inside k8s/ or .github/workflows/
# shows the tool it belongs to rather than just "YAML".
_BY_PATH_HINT: list[tuple[str, Tech]] = [
    (".github/workflows", Tech("GitHub Actions", "#2088FF", "githubactions")),
    ("k8s/", Tech("Kubernetes", "#326CE5", "kubernetes")),
    ("kubernetes/", Tech("Kubernetes", "#326CE5", "kubernetes")),
    ("helm/", Tech("Helm", "#0F1689", "helm")),
    ("terraform/", Tech("Terraform", "#7B42BC", "terraform")),
    ("migrations/", Tech("DB migration", "#E38C00", "postgresql")),
    ("android/", Tech("Android", "#3DDC84", "android")),
    ("ios/", Tech("iOS", "#E5E7EB", "apple")),
]

_UNKNOWN = Tech("Other", "#7C8296", "")


def detect(path: str) -> Tech:
    """Best-effort language/logo for a repo-relative path."""
    lower = path.lower()
    name = os.path.basename(lower)

    if name in _BY_NAME:
        return _BY_NAME[name]
    if name.startswith("dockerfile"):
        return _BY_NAME["dockerfile"]

    ext = os.path.splitext(name)[1]
    base = _BY_EXT.get(ext)

    for fragment, tech in _BY_PATH_HINT:
        if fragment in lower:
            # Keep the concrete language when we have one, borrow the logo.
            if base and base.icon_slug:
                return Tech(base.language, base.color, tech.icon_slug)
            return tech

    return base or _UNKNOWN


def slug_for_language(language: str) -> str:
    """Reverse lookup: 'TypeScript' -> 'typescript'. Empty when unknown."""
    wanted = language.strip().lower()
    for entry in _BY_EXT.values():
        if entry.language.lower() == wanted:
            return entry.icon_slug
    return ""


def pretty_name(slug: str) -> str:
    """Turn a devicon slug into something readable in the UI."""
    special = {
        "nextjs": "Next.js", "vuejs": "Vue", "nodejs": "Node.js", "vitejs": "Vite",
        "tailwindcss": "Tailwind CSS", "scikitlearn": "scikit-learn",
        "postgresql": "PostgreSQL", "mongodb": "MongoDB", "graphql": "GraphQL",
        "fastapi": "FastAPI", "nestjs": "NestJS", "threejs": "Three.js",
        "githubactions": "GitHub Actions", "sqlalchemy": "SQLAlchemy",
        "angularjs": "Angular", "mysql": "MySQL",
    }
    return special.get(slug, slug.capitalize())


def dependency_logos(manifests: dict[str, str]) -> list[str]:
    """Guess the project's headline tech from manifest text.

    Cheap keyword pass used to pre-seed the entrance panel's tech-stack row;
    Claude refines it during project analysis.
    """
    blob = "\n".join(manifests.values()).lower()
    known = {
        "react": "react", "next": "nextjs", "vue": "vuejs", "svelte": "svelte",
        "angular": "angularjs", "three": "threejs", "tailwind": "tailwindcss",
        "django": "django", "flask": "flask", "fastapi": "fastapi",
        "express": "express", "nestjs": "nestjs", "spring": "spring",
        "pytorch": "pytorch", "tensorflow": "tensorflow",
        "numpy": "numpy", "pandas": "pandas", "scikit": "scikitlearn",
        "postgres": "postgresql", "psycopg": "postgresql", "mysql": "mysql",
        "mongo": "mongodb", "redis": "redis", "sqlite": "sqlite",
        "sqlalchemy": "sqlalchemy", "prisma": "prisma", "graphql": "graphql",
        "docker": "docker", "kubernetes": "kubernetes", "vite": "vitejs",
        "webpack": "webpack", "jest": "jest", "pytest": "pytest",
        "supabase": "supabase", "firebase": "firebase",
    }
    out: list[str] = []
    for needle, slug in known.items():
        if needle in blob and slug not in out:
            out.append(slug)
    return out[:12]
