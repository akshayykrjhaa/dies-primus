"""Describe one file, on demand.

The analysis pipeline only explains a handful of files before the city opens.
Everything else arrives with a structural placeholder, and is described
properly the first time somebody actually clicks it -- which is this endpoint.

That is what keeps a run cheap. A full eager pass was roughly 180,000 input
tokens for a visitor who would open maybe five buildings; this spends about
five hundred, per building, only when it is asked for.

Results are written back into the cached city, so the second visitor to the
same building pays nothing, and into the content-keyed file cache, so the same
file is never explained twice even across branches or repositories.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..config import settings
from ..services import jobs as job_service
from ..services.analyzer import Analyzer
from ..services.github import GitHubClient, GitHubError, RepoRef
from ..services.selector import FileInfo
from ..services.sketch import sketch

router = APIRouter(prefix="/api", tags=["describe"])


class DescribeRequest(BaseModel):
    jobId: str | None = None
    cacheKey: str | None = None
    path: str


def _load(request: DescribeRequest) -> tuple[dict[str, Any], str | None]:
    """The city this file belongs to, and the cache key to write back to."""
    if request.jobId:
        job = job_service.store.get(request.jobId)
        if job and job.result:
            return job.result, None
    if request.cacheKey:
        data = job_service.cache_read(request.cacheKey)
        if data:
            return data, request.cacheKey
    raise HTTPException(status_code=404, detail="No analyzed city for this session.")


@router.post("/describe")
async def describe(request: DescribeRequest) -> dict[str, Any]:
    city, cache_key = _load(request)

    building = next(
        (b for b in city.get("buildings", []) if b.get("path") == request.path), None
    )
    if building is None:
        raise HTTPException(status_code=404, detail="No such file in this city.")

    # Already explained by the model, either eagerly or by an earlier visitor.
    if building.get("ai"):
        return {"path": request.path, "description": _fields(building), "cached": True}

    repo = city.get("repo", {})
    slug = repo.get("slug")
    branch = repo.get("branch") or ""
    if not slug:
        raise HTTPException(status_code=400, detail="This city has no repository on it.")

    owner, _, name = slug.partition("/")
    if not owner or not name:
        raise HTTPException(status_code=400, detail="This city has no repository on it.")

    try:
        # Built directly rather than parsed: the city already holds the owner,
        # the name and the exact branch it was analysed at, and the shorthand
        # parser has no form that carries a branch.
        ref = RepoRef(owner=owner, repo=name, ref=branch or None)
        async with GitHubClient() as github:
            text = await github.fetch_text(ref, request.path, 20000)
    except GitHubError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    if not text:
        raise HTTPException(status_code=404, detail="That file could not be read.")

    # Content-keyed, so an unchanged file is described once ever.
    key = job_service.describe_key(request.path, text)
    described = job_service.describe_read(key)

    if described is None:
        analyzer = Analyzer()
        try:
            info = FileInfo(
                path=request.path,
                name=request.path.rsplit("/", 1)[-1],
                ext="." + request.path.rsplit(".", 1)[-1] if "." in request.path else "",
                directory=request.path.rsplit("/", 1)[0] if "/" in request.path else ".",
                size=building.get("bytes") or len(text),
                depth=request.path.count("/"),
                score=(building.get("importance") or 5) / 10,
                loc=building.get("loc") or 0,
            )
            described = await analyzer.one_file(
                city.get("context") or f"Repository: {slug}\n",
                info,
                sketch(request.path, text, settings.file_char_budget),
            )
        finally:
            await analyzer.close()
        if described.get("ai"):
            job_service.describe_write(key, described)

    # Fold it into the city so nobody pays for this building again.
    building.update(_fields(described))
    if cache_key:
        job_service.cache_write(cache_key, city)

    return {"path": request.path, "description": _fields(described), "cached": False}


def _fields(source: dict[str, Any]) -> dict[str, Any]:
    """The narration fields, in the shape the frontend already renders."""
    return {
        "headline": source.get("headline") or "",
        "summary": source.get("summary") or "",
        "detail": source.get("detail") or "",
        "tags": source.get("tags") or [],
        "keySymbols": source.get("keySymbols") or source.get("key_symbols") or [],
        "connectsTo": source.get("connectsTo") or source.get("connects_to") or [],
        "ai": bool(source.get("ai")),
    }
