"""The signed-in user's own GitHub data: repos, commits, contribution stats."""
from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response

from ..services import auth as auth_service
from ..services import profile as profile_service

router = APIRouter(prefix="/api", tags=["profile"])


NO_STORE = {"Cache-Control": "no-store"}


@router.get("/profile")
async def profile(request: Request, response: Response) -> dict[str, Any]:
    # Session-dependent: an exception short-circuits past the `response`
    # object below, so a raised HTTPException carries its own no-store
    # header too — otherwise a cached 401 could outlive a real login.
    response.headers["Cache-Control"] = "no-store"
    session = auth_service.get_session(request)
    if session is None:
        raise HTTPException(status_code=401, detail="Not signed in.", headers=NO_STORE)

    login = session.user.get("login", "")
    try:
        repos, stats = await asyncio.gather(
            profile_service.fetch_repos(session.github_token),
            profile_service.fetch_contribution_stats(session.github_token, login),
        )
    except profile_service.ProfileError as exc:
        raise HTTPException(status_code=502, detail=str(exc), headers=NO_STORE) from exc

    stats["totalStars"] = sum(r["stars"] for r in repos)

    return {
        "user": session.public(),
        "repos": repos,
        "stats": stats,
    }
