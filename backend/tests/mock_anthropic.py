"""A stand-in for the Claude API, used to exercise the analyzer without a key.

It speaks just enough of the Messages streaming protocol for the SDK to build a
real Message object, and it answers with JSON that matches whatever schema the
caller asked for in `output_config.format`. Run it, point ANTHROPIC_BASE_URL at
it, and the whole pipeline runs offline.

    python -m uvicorn tests.mock_anthropic:app --port 8099
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse

app = FastAPI(title="Mock Claude API")


def _fake_project() -> dict[str, Any]:
    return {
        "tagline": "A mocked briefing produced without calling Claude.",
        "overview": "This overview came from the mock server, which exists so the "
                    "analysis pipeline can be tested end to end offline.",
        "architecture": "Districts map to directories; buildings map to files.",
        "tech_stack": [
            {"name": "Python", "slug": "python", "role": "Backend and the agent"},
            {"name": "React", "slug": "react", "role": "The city frontend"},
        ],
        "highlights": ["Runs without an API key", "Structured outputs end to end"],
        "entry_points": ["src/index.ts"],
        "districts": [{"path": "src", "name": "Source Quarter", "purpose": "The library itself."}],
        "how_it_works": [{"step": "Fetch", "detail": "The tree is pulled from GitHub."}],
        "getting_started": "npm install && npm run dev",
    }


def _fake_files(paths: list[str]) -> dict[str, Any]:
    return {
        "files": [
            {
                "path": path,
                "headline": f"Mocked description of {path.split('/')[-1]}",
                "summary": f"{path} was described by the mock server.",
                "detail": f"A longer mocked explanation for {path}, standing in for "
                          "the text Claude would write about this file.",
                "role": "business-logic",
                "tags": ["mock", "offline"],
                "key_symbols": ["mockSymbol"],
                "connects_to": [],
                "importance": 6,
            }
            for path in paths
        ]
    }


def _paths_from_prompt(prompt: str) -> list[str]:
    paths: list[str] = []
    for line in prompt.splitlines():
        if line.startswith("--- FILE: "):
            paths.append(line.removeprefix("--- FILE: ").split(" (")[0])
    return paths


def _sse(event: str, payload: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload)}\n\n"


@app.post("/v1/messages")
async def messages(request: Request) -> StreamingResponse:
    body = await request.json()

    prompt = ""
    for message in body.get("messages", []):
        content = message.get("content")
        prompt += content if isinstance(content, str) else json.dumps(content)

    schema = (body.get("output_config") or {}).get("format", {}).get("schema", {})
    if "files" in (schema.get("properties") or {}):
        answer = _fake_files(_paths_from_prompt(prompt))
    else:
        answer = _fake_project()
    text = json.dumps(answer)

    async def stream():
        yield _sse(
            "message_start",
            {
                "type": "message_start",
                "message": {
                    "id": "msg_mock",
                    "type": "message",
                    "role": "assistant",
                    "model": body.get("model", "claude-opus-5"),
                    "content": [],
                    "stop_reason": None,
                    "stop_sequence": None,
                    "usage": {"input_tokens": 1200, "output_tokens": 0},
                },
            },
        )
        yield _sse(
            "content_block_start",
            {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
        )
        # Chunk it, so the SDK exercises its delta accumulation path.
        for start in range(0, len(text), 400):
            yield _sse(
                "content_block_delta",
                {
                    "type": "content_block_delta",
                    "index": 0,
                    "delta": {"type": "text_delta", "text": text[start : start + 400]},
                },
            )
        yield _sse("content_block_stop", {"type": "content_block_stop", "index": 0})
        yield _sse(
            "message_delta",
            {
                "type": "message_delta",
                "delta": {"stop_reason": "end_turn", "stop_sequence": None},
                "usage": {"output_tokens": len(text) // 4},
            },
        )
        yield _sse("message_stop", {"type": "message_stop"})

    return StreamingResponse(stream(), media_type="text/event-stream")
