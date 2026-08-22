"""The "Connect GitHub" login: OAuth handshake, session lookup, sign-out."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse

from ..config import settings
from ..services import auth as auth_service

router = APIRouter(prefix="/api/auth", tags=["auth"])

STATE_MAX_AGE = 600  # the GitHub authorize/callback round trip is seconds, not minutes


@router.get("/github/login")
async def github_login() -> RedirectResponse:
    if not settings.has_github_oauth:
        return RedirectResponse(
            f"{settings.frontend_url}/?auth_error=github_oauth_not_configured"
        )

    state = auth_service.new_state()
    response = RedirectResponse(auth_service.authorize_url(state), status_code=302)
    response.set_cookie(
        auth_service.STATE_COOKIE,
        state,
        max_age=STATE_MAX_AGE,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
    )
    return response


@router.get("/github/callback")
async def github_callback(request: Request) -> RedirectResponse:
    code = request.query_params.get("code")
    state = request.query_params.get("state")
    cookie_state = request.cookies.get(auth_service.STATE_COOKIE)

    def error_redirect(reason: str) -> RedirectResponse:
        response = RedirectResponse(f"{settings.frontend_url}/?auth_error={reason}")
        response.delete_cookie(auth_service.STATE_COOKIE)
        return response

    if not code or not state or not cookie_state or state != cookie_state:
        return error_redirect("state_mismatch")

    try:
        token = await auth_service.exchange_code_for_token(code)
        user = await auth_service.fetch_github_user(token)
    except auth_service.OAuthError:
        return error_redirect("github_oauth_failed")

    session = auth_service.store.create(token, user)
    response = RedirectResponse(f"{settings.frontend_url}/?connected=1")
    response.delete_cookie(auth_service.STATE_COOKIE)
    response.set_cookie(
        auth_service.SESSION_COOKIE,
        session.id,
        max_age=auth_service.SESSION_TTL,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
    )
    return response


@router.get("/me")
async def me(request: Request, response: Response) -> dict[str, Any]:
    # Session-dependent: never let the browser (or a proxy) cache this across
    # a login/logout, or a stale "signed in as X" can outlive the session.
    response.headers["Cache-Control"] = "no-store"
    session = auth_service.get_session(request)
    if session is None:
        return {"authenticated": False}
    return session.public()


@router.post("/logout")
async def logout(request: Request) -> JSONResponse:
    auth_service.store.delete(request.cookies.get(auth_service.SESSION_COOKIE))
    response = JSONResponse({"ok": True})
    response.delete_cookie(auth_service.SESSION_COOKIE)
    return response
