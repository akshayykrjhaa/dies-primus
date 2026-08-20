"""Ask-the-city endpoint: a grounded Q&A tour guide over an analyzed repo.

The city JSON already holds a compressed description of every building, so a
question can be answered from that index without re-reading the repository.
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..services import jobs as job_service
from ..services.llm import make_llm

router = APIRouter(prefix="/api", tags=["chat"])

SYSTEM = (
    "You are the tour guide of a 3D city where every building is a file from a "
    "GitHub repository. Answer questions about the codebase using only the "
    "briefing below. Be direct and concrete, cite file paths in backticks, and "
    "keep answers under 180 words unless asked for more. If the briefing does "
    "not cover something, say so plainly rather than guessing."
)


class ChatRequest(BaseModel):
    jobId: str | None = None
    cacheKey: str | None = None
    question: str
    focusPath: str | None = None


def _load_city(request: ChatRequest) -> dict[str, Any]:
    if request.jobId:
        job = job_service.store.get(request.jobId)
        if job and job.result:
            return job.result
    if request.cacheKey:
        data = job_service.cache_read(request.cacheKey)
        if data:
            return data
    raise HTTPException(status_code=404, detail="No analyzed city for this session.")


def _briefing(city: dict[str, Any], focus_path: str | None) -> str:
    repo = city.get("repo", {})
    project = city.get("project", {})
    lines = [
        f"REPOSITORY: {repo.get('slug')} ({repo.get('url')})",
        f"TAGLINE: {project.get('tagline', '')}",
        f"OVERVIEW: {project.get('overview', '')}",
        f"ARCHITECTURE: {project.get('architecture', '')}",
        "",
        "DISTRICTS:",
    ]
    for district in city.get("districts", [])[:40]:
        lines.append(
            f"- {district['path']} ({district['fileCount']} files): "
            f"{district.get('purpose') or district.get('name')}"
        )

    lines.append("")
    lines.append("BUILDINGS (path | role | what it is):")
    buildings = sorted(city.get("buildings", []), key=lambda b: -b.get("importance", 0))
    for building in buildings[:220]:
        lines.append(
            f"- {building['path']} | {building.get('role')} | "
            f"{building.get('headline')} :: {building.get('summary', '')[:220]}"
        )

    if focus_path:
        match = next(
            (b for b in city.get("buildings", []) if b["path"] == focus_path), None
        )
        if match:
            lines += [
                "",
                f"THE VISITOR IS STANDING IN FRONT OF: {match['path']}",
                f"Detail: {match.get('detail', '')}",
                f"Key symbols: {', '.join(match.get('keySymbols', []))}",
            ]
    return "\n".join(lines)


@router.post("/chat")
async def chat(request: ChatRequest) -> StreamingResponse:
    city = _load_city(request)
    llm = make_llm()
    briefing = _briefing(city, request.focusPath)
    question = (
        "=== CITY BRIEFING ===\n"
        f"{briefing}\n\n"
        "=== VISITOR QUESTION ===\n"
        f"{request.question}"
    )

    async def stream():
        try:
            async for chunk in llm.stream_text(SYSTEM, question):
                yield f"data: {json.dumps({'type': 'text', 'text': chunk})}\n\n"
        except Exception as exc:  # noqa: BLE001 - shown to the visitor verbatim
            yield f"data: {json.dumps({'type': 'error', 'text': str(exc)})}\n\n"
        finally:
            await llm.close()
            yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
