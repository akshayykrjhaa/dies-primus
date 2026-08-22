"""GitHub OAuth: the "Connect GitHub" login and its server-side sessions.

The access token GitHub hands back never reaches the browser. It is kept in
an in-memory session store (mirrors services/jobs.py's JobStore) and the
browser only ever holds an opaque session id in an httpOnly cookie, so a
compromised frontend can't exfiltrate the token itself. CSRF is covered by a
one-time `state` value round-tripped through a short-lived cookie during the
handshake.
"""
from __future__ import annotations

import secrets
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlencode

import httpx

from ..config import settings

AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
TOKEN_URL = "https://github.com/login/oauth/access_token"
USER_URL = "https://api.github.com/user"

SESSION_COOKIE = "rc_session"
STATE_COOKIE = "rc_oauth_state"
SESSION_TTL = 7 * 24 * 3600  # 7 days


class OAuthError(RuntimeError):
    """Raised for anything the user needs to see during the OAuth handshake."""


@dataclass
class Session:
    id: str
    github_token: str
    user: dict[str, Any]
    created_at: float = field(default_factory=time.time)

    def public(self) -> dict[str, Any]:
        return {
            "authenticated": True,
            "login": self.user.get("login"),
            "name": self.user.get("name") or self.user.get("login"),
            "avatarUrl": self.user.get("avatar_url"),
            "htmlUrl": self.user.get("html_url"),
        }


class SessionStore:
    """Process-local session table. Restarting the API signs everyone out,
    same tradeoff the job cache already makes for analysis results."""

    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}

    def create(self, github_token: str, user: dict[str, Any]) -> Session:
        session = Session(id=secrets.token_urlsafe(32), github_token=github_token, user=user)
        self._sessions[session.id] = session
        return session

    def get(self, session_id: str | None) -> Session | None:
        if not session_id:
            return None
        session = self._sessions.get(session_id)
        if session is None:
            return None
        if time.time() - session.created_at > SESSION_TTL:
            self._sessions.pop(session_id, None)
            return None
        return session

    def delete(self, session_id: str | None) -> None:
        if session_id:
            self._sessions.pop(session_id, None)


store = SessionStore()


def new_state() -> str:
    return secrets.token_urlsafe(24)


def authorize_url(state: str) -> str:
    params = {
        "client_id": settings.github_client_id,
        "redirect_uri": settings.github_oauth_redirect_uri,
        "scope": settings.github_oauth_scopes,
        "state": state,
        "allow_signup": "true",
    }
    return f"{AUTHORIZE_URL}?{urlencode(params)}"


async def exchange_code_for_token(code: str) -> str:
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(
            TOKEN_URL,
            headers={"Accept": "application/json"},
            data={
                "client_id": settings.github_client_id,
                "client_secret": settings.github_client_secret,
                "code": code,
                "redirect_uri": settings.github_oauth_redirect_uri,
            },
        )
    if response.status_code >= 400:
        raise OAuthError(f"GitHub token exchange failed ({response.status_code}).")
    payload = response.json()
    if payload.get("error"):
        raise OAuthError(payload.get("error_description") or payload["error"])
    token = payload.get("access_token")
    if not token:
        raise OAuthError("GitHub did not return an access token.")
    return token


async def fetch_github_user(token: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(
            USER_URL,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "repo-city-tour",
            },
        )
    if response.status_code >= 400:
        raise OAuthError(f"Could not read the GitHub profile ({response.status_code}).")
    return response.json()
