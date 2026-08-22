"""Analysis endpoints: kick off a job, follow it, read the finished city."""
from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..config import settings
from ..services import auth as auth_service
from ..services import jobs as job_service
from ..services.github import GitHubError, parse_repo_url
from ..services.pipeline import run_analysis

router = APIRouter(prefix="/api", tags=["analysis"])


class AnalyzeRequest(BaseModel):
    repoUrl: str = Field(..., description="GitHub URL or owner/repo shorthand")
    force: bool = False


class AnalyzeResponse(BaseModel):
    jobId: str
    slug: str
    cached: bool = False


@router.get("/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "aiEnabled": settings.has_llm,
        "provider": settings.provider,
        "githubToken": bool(settings.github_token),
        "githubOAuthEnabled": settings.has_github_oauth,
        "model": settings.model,
        "limits": {
            "maxBuildings": settings.max_buildings,
            "maxFilesReadByAI": settings.max_llm_files,
        },
        "note": (
            ""
            if settings.has_llm
            else "No model API key is set: cities will render with structural "
                 "descriptions only. Add GROQ_API_KEY to backend/.env."
        ),
    }


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze(request: AnalyzeRequest, http_request: Request) -> AnalyzeResponse:
    try:
        ref = parse_repo_url(request.repoUrl)
    except GitHubError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not request.force:
        existing = job_service.store.find_done(ref.slug)
        if existing:
            return AnalyzeResponse(jobId=existing.id, slug=ref.slug, cached=True)

    job = job_service.store.create(request.repoUrl)

    session = auth_service.get_session(http_request)
    github_token = session.github_token if session else None

    async def runner() -> None:
        try:
            await run_analysis(job, force=request.force, github_token=github_token)
        except Exception:  # already recorded on the job
            pass

    asyncio.create_task(runner())
    return AnalyzeResponse(jobId=job.id, slug=ref.slug)


@router.get("/jobs/{job_id}")
async def job_status(job_id: str) -> dict[str, Any]:
    job = job_service.store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown job id.")
    payload = job.snapshot()
    if job.status == "done":
        payload["result"] = job.result
    return payload


@router.get("/jobs/{job_id}/events")
async def job_events(job_id: str) -> StreamingResponse:
    job = job_service.store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown job id.")

    async def stream():
        queue = job.subscribe()
        try:
            while True:
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=20.0)
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"      # keeps proxies from closing us
                    continue
                yield f"data: {json.dumps(payload)}\n\n"
                if payload["status"] in ("done", "error"):
                    break
        finally:
            job.unsubscribe(queue)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/city/{job_id}")
async def city(job_id: str) -> dict[str, Any]:
    job = job_service.store.get(job_id)
    if job is None or job.result is None:
        raise HTTPException(status_code=404, detail="City not ready.")
    return job.result


@router.get("/recent")
async def recent() -> dict[str, Any]:
    return {"items": job_service.cache_list()}


@router.get("/cached/{cache_key}")
async def cached(cache_key: str) -> dict[str, Any]:
    data = job_service.cache_read(cache_key)
    if data is None:
        raise HTTPException(status_code=404, detail="Not in cache.")
    return data
