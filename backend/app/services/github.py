"""Thin async GitHub client: metadata, file tree and raw file contents."""
from __future__ import annotations

import asyncio
import base64
import re
from dataclasses import dataclass, field
from typing import Any

import httpx

from ..config import settings

API = "https://api.github.com"
RAW = "https://raw.githubusercontent.com"

_URL_RE = re.compile(
    r"^(?:https?://)?(?:www\.)?github\.com/(?P<owner>[\w.\-]+)/(?P<repo>[\w.\-]+)"
    r"(?:/tree/(?P<ref>[\w.\-/]+))?/?.*$"
)
_SHORT_RE = re.compile(r"^(?P<owner>[\w.\-]+)/(?P<repo>[\w.\-]+)$")


class GitHubError(RuntimeError):
    """Raised for anything the user needs to see: 404, rate limit, bad URL."""


@dataclass
class RepoRef:
    owner: str
    repo: str
    ref: str | None = None

    @property
    def slug(self) -> str:
        return f"{self.owner}/{self.repo}"


@dataclass
class TreeEntry:
    path: str
    size: int
    sha: str


@dataclass
class RepoSnapshot:
    ref: RepoRef
    meta: dict[str, Any]
    default_branch: str
    commit_sha: str
    tree: list[TreeEntry]
    languages: dict[str, int] = field(default_factory=dict)
    readme: str = ""
    truncated: bool = False

    @property
    def html_url(self) -> str:
        return self.meta.get("html_url") or f"https://github.com/{self.ref.slug}"


def parse_repo_url(url: str) -> RepoRef:
    """Accepts a full GitHub URL, an owner/repo shorthand, or a .git clone URL."""
    raw = (url or "").strip()
    if not raw:
        raise GitHubError("Please provide a GitHub repository URL.")
    raw = raw.removesuffix(".git")

    match = _URL_RE.match(raw) or _SHORT_RE.match(raw)
    if not match:
        raise GitHubError(
            f"'{url}' does not look like a GitHub repository. "
            "Try https://github.com/owner/repo"
        )
    groups = match.groupdict()
    return RepoRef(
        owner=groups["owner"],
        repo=groups["repo"].removesuffix(".git"),
        ref=groups.get("ref"),
    )


def _headers(token: str | None) -> dict[str, str]:
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "repo-city-tour",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _explain(response: httpx.Response, what: str) -> GitHubError:
    if response.status_code == 404:
        return GitHubError(
            f"{what} not found (404). Check the URL, and set GITHUB_TOKEN in "
            "backend/.env if the repository is private."
        )
    if response.status_code in (401, 403):
        remaining = response.headers.get("x-ratelimit-remaining")
        if remaining == "0":
            return GitHubError(
                "GitHub rate limit reached. Add a GITHUB_TOKEN to backend/.env "
                "to raise the limit from 60 to 5000 requests per hour."
            )
        return GitHubError(f"GitHub denied access to {what} ({response.status_code}).")
    return GitHubError(f"GitHub returned {response.status_code} for {what}.")


class GitHubClient:
    def __init__(self, token: str | None = None) -> None:
        """`token` is a logged-in user's own OAuth token, when present;
        otherwise falls back to the server's static GITHUB_TOKEN, if any."""
        self._client = httpx.AsyncClient(
            headers=_headers(token or settings.github_token), timeout=30.0, follow_redirects=True
        )

    async def __aenter__(self) -> "GitHubClient":
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self._client.aclose()

    async def _get_json(self, url: str, what: str) -> Any:
        response = await self._client.get(url)
        if response.status_code >= 400:
            raise _explain(response, what)
        return response.json()

    async def snapshot(self, ref: RepoRef) -> RepoSnapshot:
        """One round of metadata + tree + languages + README."""
        meta = await self._get_json(f"{API}/repos/{ref.owner}/{ref.repo}", ref.slug)
        default_branch = meta.get("default_branch") or "main"
        target = ref.ref or default_branch

        tree_json, languages, readme = await asyncio.gather(
            self._get_json(
                f"{API}/repos/{ref.owner}/{ref.repo}/git/trees/{target}?recursive=1",
                f"file tree of {ref.slug}",
            ),
            self._languages(ref),
            self._readme(ref),
        )

        entries = [
            TreeEntry(path=node["path"], size=int(node.get("size") or 0), sha=node["sha"])
            for node in tree_json.get("tree", [])
            if node.get("type") == "blob"
        ]
        return RepoSnapshot(
            ref=RepoRef(ref.owner, ref.repo, target),
            meta=meta,
            default_branch=default_branch,
            commit_sha=tree_json.get("sha") or target,
            tree=entries,
            languages=languages,
            readme=readme,
            truncated=bool(tree_json.get("truncated")),
        )

    async def _languages(self, ref: RepoRef) -> dict[str, int]:
        try:
            return await self._get_json(
                f"{API}/repos/{ref.owner}/{ref.repo}/languages", "languages"
            )
        except GitHubError:
            return {}

    async def _readme(self, ref: RepoRef) -> str:
        try:
            data = await self._get_json(f"{API}/repos/{ref.owner}/{ref.repo}/readme", "readme")
        except GitHubError:
            return ""
        try:
            return base64.b64decode(data.get("content", "")).decode("utf-8", "replace")
        except Exception:
            return ""

    async def fetch_text(self, ref: RepoRef, path: str, max_chars: int) -> str:
        """Fetch one file from raw.githubusercontent, truncated to max_chars."""
        url = f"{RAW}/{ref.owner}/{ref.repo}/{ref.ref}/{path}"
        try:
            response = await self._client.get(url)
        except httpx.HTTPError:
            return ""
        if response.status_code >= 400:
            return ""
        text = response.text
        if len(text) > max_chars:
            text = text[:max_chars] + "\n... [truncated]"
        return text

    async def fetch_many(
        self, ref: RepoRef, paths: list[str], max_chars: int, concurrency: int = 8
    ) -> dict[str, str]:
        semaphore = asyncio.Semaphore(concurrency)

        async def one(path: str) -> tuple[str, str]:
            async with semaphore:
                return path, await self.fetch_text(ref, path, max_chars)

        results = await asyncio.gather(*(one(p) for p in paths))
        return {path: text for path, text in results if text}
