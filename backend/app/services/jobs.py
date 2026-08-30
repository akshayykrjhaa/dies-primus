"""In-memory job registry plus a disk cache of finished cities.

Analyzing a repo takes tens of seconds, so the HTTP request returns a job id
immediately and the browser follows progress over SSE. Finished results are
written to backend/.cache so a repeat visit (or a demo rerun) is instant.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
from pathlib import Path
import re
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from ..config import settings

_SAFE = re.compile(r"[^a-zA-Z0-9._-]+")


@dataclass
class Job:
    id: str
    repo_url: str
    status: str = "queued"           # queued | running | done | error
    stage: str = "Queued"
    progress: float = 0.0
    error: str = ""
    result: dict[str, Any] | None = None
    created_at: float = field(default_factory=time.time)
    log: list[dict[str, Any]] = field(default_factory=list)
    _subscribers: list[asyncio.Queue] = field(default_factory=list, repr=False)

    def snapshot(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "repoUrl": self.repo_url,
            "status": self.status,
            "stage": self.stage,
            "progress": round(self.progress, 3),
            "error": self.error,
            "log": self.log[-40:],
        }

    def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()
        self._subscribers.append(queue)
        queue.put_nowait(self.snapshot())
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        if queue in self._subscribers:
            self._subscribers.remove(queue)

    def _emit(self) -> None:
        payload = self.snapshot()
        for queue in list(self._subscribers):
            queue.put_nowait(payload)

    async def update(self, stage: str, progress: float) -> None:
        self.status = "running"
        self.stage = stage
        self.progress = max(self.progress, progress)
        self.log.append({"t": round(time.time() - self.created_at, 1), "stage": stage})
        self._emit()
        await asyncio.sleep(0)  # let the SSE task flush

    def finish(self, result: dict[str, Any]) -> None:
        self.status = "done"
        self.stage = "Ready"
        self.progress = 1.0
        self.result = result
        self._emit()

    def fail(self, message: str) -> None:
        self.status = "error"
        self.stage = "Failed"
        self.error = message
        self._emit()


class JobStore:
    def __init__(self, keep: int = 40) -> None:
        self._jobs: dict[str, Job] = {}
        self._keep = keep

    def create(self, repo_url: str) -> Job:
        job = Job(id=uuid.uuid4().hex[:12], repo_url=repo_url)
        self._jobs[job.id] = job
        if len(self._jobs) > self._keep:
            oldest = sorted(self._jobs.values(), key=lambda j: j.created_at)[0]
            self._jobs.pop(oldest.id, None)
        return job

    def get(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    def find_done(self, slug: str) -> Job | None:
        for job in sorted(self._jobs.values(), key=lambda j: -j.created_at):
            if job.status == "done" and job.result:
                if job.result.get("repo", {}).get("slug", "").lower() == slug.lower():
                    return job
        return None


store = JobStore()


# ----------------------------------------------------------------- disk cache

def cache_key(slug: str, commit_sha: str) -> str:
    digest = hashlib.sha1(f"{slug}@{commit_sha}".encode()).hexdigest()[:10]
    return f"{_SAFE.sub('-', slug)}-{digest}.json"


def cache_read(key: str) -> dict[str, Any] | None:
    path = settings.cache_dir / key
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def cache_write(key: str, payload: dict[str, Any]) -> None:
    path = settings.cache_dir / key
    try:
        path.write_text(json.dumps(payload), encoding="utf-8")
    except OSError:
        pass


def describe_key(path: str, content: str) -> str:
    """Cache key for one file's description: its path plus its contents.

    Keyed on the *content*, not the commit, so a file that did not change
    between two commits is described once, and a file that appears in two
    branches -- or two repositories -- is described once for both. Path is in
    the key as well because the same bytes mean different things in different
    places.
    """
    blob = f"{path}::{len(content)}::{content}"
    return hashlib.sha1(blob.encode("utf-8", "replace")).hexdigest()[:20]


def _describe_dir() -> Path:
    directory = settings.cache_dir / "files"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def describe_read(key: str) -> dict[str, Any] | None:
    path = _describe_dir() / f"{key}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def describe_write(key: str, payload: dict[str, Any]) -> None:
    try:
        (_describe_dir() / f"{key}.json").write_text(
            json.dumps(payload), encoding="utf-8"
        )
    except OSError:
        pass


def cache_list() -> list[dict[str, Any]]:
    """Everything already analyzed -- powers the 'recent cities' row."""
    items: list[dict[str, Any]] = []
    for path in settings.cache_dir.glob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        repo = data.get("repo", {})
        if not repo.get("slug"):
            continue
        items.append(
            {
                "slug": repo["slug"],
                "url": repo.get("url", ""),
                "description": repo.get("description", ""),
                "buildings": data.get("stats", {}).get("buildings", 0),
                "cacheKey": path.name,
                "cachedAt": path.stat().st_mtime,
            }
        )
    return sorted(items, key=lambda item: -item["cachedAt"])[:12]
