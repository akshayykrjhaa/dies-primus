"""The signed-in user's own GitHub data: repos and contribution stats.

Commit counts come from the GraphQL `contributionsCollection`, not the REST
API — GitHub has no "all my commits" REST endpoint, and walking every repo's
/commits with an author filter would be one request per repo. GraphQL
answers it in a single call, scoped to the calling user's own token.
"""
from __future__ import annotations

from typing import Any

import httpx

REST = "https://api.github.com"
GRAPHQL = "https://api.github.com/graphql"

CONTRIBUTIONS_QUERY = """
query($login: String!) {
  user(login: $login) {
    followers { totalCount }
    following { totalCount }
    contributionsCollection {
      totalCommitContributions
      totalPullRequestContributions
      totalIssueContributions
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays { date contributionCount }
        }
      }
    }
  }
}
"""


class ProfileError(RuntimeError):
    """Raised when GitHub refuses a profile-data request."""


def _headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "repo-city-tour",
    }


async def fetch_repos(token: str, limit: int = 12) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(
            f"{REST}/user/repos",
            headers=_headers(token),
            params={
                "sort": "pushed",
                "direction": "desc",
                "per_page": limit,
                "affiliation": "owner",
            },
        )
    if response.status_code >= 400:
        raise ProfileError(f"Could not list repositories ({response.status_code}).")
    return [
        {
            "name": r["name"],
            "fullName": r["full_name"],
            "description": r.get("description") or "",
            "url": r["html_url"],
            "language": r.get("language") or "",
            "stars": r.get("stargazers_count", 0),
            "forks": r.get("forks_count", 0),
            "private": r.get("private", False),
            "pushedAt": r.get("pushed_at") or "",
        }
        for r in response.json()
    ]


async def fetch_contribution_stats(token: str, login: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(
            GRAPHQL,
            headers=_headers(token),
            json={"query": CONTRIBUTIONS_QUERY, "variables": {"login": login}},
        )
    if response.status_code >= 400:
        raise ProfileError(f"Could not read contribution stats ({response.status_code}).")
    payload = response.json()
    if payload.get("errors"):
        raise ProfileError(payload["errors"][0].get("message", "GitHub GraphQL error."))

    user = (payload.get("data") or {}).get("user") or {}
    collection = user.get("contributionsCollection") or {}
    calendar = collection.get("contributionCalendar") or {}
    calendar_days = [
        {"date": day["date"], "count": day["contributionCount"]}
        for week in calendar.get("weeks", [])
        for day in week.get("contributionDays", [])
    ]
    return {
        "followers": (user.get("followers") or {}).get("totalCount", 0),
        "following": (user.get("following") or {}).get("totalCount", 0),
        "totalCommits": collection.get("totalCommitContributions", 0),
        "totalPullRequests": collection.get("totalPullRequestContributions", 0),
        "totalIssues": collection.get("totalIssueContributions", 0),
        "totalContributionsLastYear": calendar.get("totalContributions", 0),
        "calendar": calendar_days,
    }
