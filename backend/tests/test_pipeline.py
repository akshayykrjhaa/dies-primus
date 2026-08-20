"""End-to-end smoke test for the analysis pipeline.

Runs the real GitHub fetch and the real city builder, but points the Anthropic
SDK at tests/mock_anthropic.py so the AI path is exercised without a key or a
bill. Start the mock first:

    .venv/Scripts/python -m uvicorn tests.mock_anthropic:app --port 8099

then:

    .venv/Scripts/python -m tests.test_pipeline [owner/repo]
"""
from __future__ import annotations

import asyncio
import os
import sys

# Must be set before app.config is imported. These are assignments, not
# setdefault: the point of the test is to redirect the SDK at the mock even if
# the shell already exports ANTHROPIC_BASE_URL.
os.environ["LLM_PROVIDER"] = "anthropic"
os.environ["ANTHROPIC_API_KEY"] = "mock-key-for-tests"
os.environ["ANTHROPIC_BASE_URL"] = os.getenv("MOCK_CLAUDE_URL", "http://127.0.0.1:8099")
os.environ["MAX_BUILDINGS"] = "80"
os.environ["MAX_LLM_FILES"] = "20"

from app.services.jobs import Job  # noqa: E402
from app.services.pipeline import run_analysis  # noqa: E402

FAILURES: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    mark = "PASS" if condition else "FAIL"
    print(f"  [{mark}] {label}{(' — ' + detail) if detail else ''}")
    if not condition:
        FAILURES.append(label)


async def main(repo: str) -> int:
    job = Job(id="test", repo_url=repo)
    print(f"\nAnalyzing {repo} against the mock Claude API\n")
    city = await run_analysis(job, force=True)

    buildings = city["buildings"]
    districts = city["districts"]
    ai_described = [b for b in buildings if b["ai"]]

    check("job finished", job.status == "done", job.error)
    check("buildings were created", len(buildings) > 0, f"{len(buildings)} buildings")
    check("districts were created", len(districts) > 0, f"{len(districts)} districts")
    check(
        "the AI path produced descriptions",
        len(ai_described) > 0,
        f"{len(ai_described)} files described by the (mock) model",
    )
    check(
        "the project briefing came from the model",
        city["project"].get("ai") is True,
        city["project"].get("tagline", "")[:60],
    )
    check("llm calls were made", city["stats"]["llmCalls"] > 0, f"{city['stats']['llmCalls']} calls")
    check("token usage was recorded", city["stats"]["inputTokens"] > 0)
    check("no analyzer warnings", not city["stats"]["warnings"], str(city["stats"]["warnings"]))

    # Geometry sanity: nothing overlapping, nothing off the map.
    half_w = city["bounds"]["width"] / 2 + 40
    half_d = city["bounds"]["depth"] / 2 + 40
    in_bounds = all(abs(b["x"]) <= half_w and abs(b["z"]) <= half_d for b in buildings)
    check("every building is inside the city bounds", in_bounds)

    positions = {(round(b["x"], 1), round(b["z"], 1)) for b in buildings}
    check("no two buildings share a plot", len(positions) == len(buildings))

    check("every building has a height", all(b["height"] > 0 for b in buildings))
    check("every building has a summary", all(b["headline"] for b in buildings))
    check(
        "logos were assigned",
        sum(1 for b in buildings if b["iconSlug"]) > len(buildings) * 0.5,
        f"{sum(1 for b in buildings if b['iconSlug'])}/{len(buildings)} have a logo",
    )
    check("the entrance sits south of the city", city["entrance"]["z"] > half_d - 40)

    print()
    if FAILURES:
        print(f"{len(FAILURES)} check(s) failed: {', '.join(FAILURES)}")
        return 1
    print("All checks passed.")
    return 0


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "vercel/swr"
    raise SystemExit(asyncio.run(main(target)))
