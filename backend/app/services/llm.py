"""One narrator interface, two providers.

Both back ends answer with schema-validated JSON, so everything downstream
treats a model response as data rather than prose to parse:

  * Groq   -- strict `json_schema` response format (default; very fast)
  * Claude -- `output_config.format` structured outputs

Whichever is configured, a failure never takes the run down: `structured()`
returns None and the caller falls back to a heuristic description.
"""
from __future__ import annotations

import asyncio
import json
from typing import Any, AsyncIterator

from ..config import settings
from .ratelimit import TokenBudget, estimate_tokens

# Groq's reasoning models take low/medium/high; Claude also accepts xhigh/max.
_GROQ_EFFORT = {"low": "low", "medium": "medium", "high": "high", "xhigh": "high", "max": "high"}


class LLM:
    """Base class: tracks usage and errors so the UI can report them."""

    provider = "none"

    def __init__(self) -> None:
        self.model = settings.model
        self.enabled = settings.has_llm
        self.calls = 0
        self.input_tokens = 0
        self.output_tokens = 0
        self.errors: list[str] = []

    async def structured(
        self,
        system: str,
        prompt: str,
        schema: dict[str, Any],
        name: str,
        effort: str,
        kind: str = "files",
    ) -> dict[str, Any] | None:
        raise NotImplementedError

    def stream_text(self, system: str, prompt: str) -> AsyncIterator[str]:
        raise NotImplementedError

    async def close(self) -> None:
        return None

    def _record_error(self, message: str) -> None:
        # Keep the list short: the UI only ever shows the first one.
        if len(self.errors) < 8:
            self.errors.append(message)


# Groq meters tokens per *account*, not per request or per job -- two
# analyses running at once share one real quota whether our code knows it or
# not. Each GroqLLM used to keep its own TokenBudget, so two concurrent jobs
# would each assume the full allowance and double-book it, drawing real 429s
# from Groq that neither side's bookkeeping accounted for. These budgets are
# module-level singletons, one per model, so every job in this process -- and
# every concurrent request within a job -- draws from the same ledger.
_MODEL_BUDGETS: dict[str, TokenBudget] = {}


def _budget_for(model: str) -> TokenBudget:
    budget = _MODEL_BUDGETS.get(model)
    if budget is None:
        budget = TokenBudget(settings.groq_tpm)
        _MODEL_BUDGETS[model] = budget
    return budget


class GroqLLM(LLM):
    provider = "groq"

    def __init__(self) -> None:
        super().__init__()
        from groq import AsyncGroq

        self._client = AsyncGroq(**settings.groq_kwargs()) if self.enabled else None
        # `reasoning_effort` is only accepted by the reasoning families.
        self._supports_effort = any(
            tag in self.model for tag in ("gpt-oss", "qwen", "compound")
        )
        # Groq meters tokens per model, so every model in the pool gets its
        # own per-minute allowance and the batches fan out across them.
        self._pool = settings.file_models
        self._next = 0
        self.throttled_seconds = 0.0

    def _pick_model(self, kind: str) -> str:
        """The briefing gets the primary model; file batches share the pool."""
        if kind != "files" or len(self._pool) == 1:
            return self.model
        model = self._pool[self._next % len(self._pool)]
        self._next += 1
        return model

    async def close(self) -> None:
        if self._client is not None:
            await self._client.close()

    def _kwargs(self, effort: str) -> dict[str, Any]:
        extra: dict[str, Any] = {}
        if self._supports_effort:
            extra["reasoning_effort"] = _GROQ_EFFORT.get(effort, "medium")
        return extra

    def _output_reservation(self, kind: str) -> int:
        """How much completion room to book against the budget.

        A flat reservation (the old behaviour) badly over-books a small file
        batch: at ~1800 tokens reserved per request against a 7200-token
        window, only one request per model can be in flight at a time, and
        every other request stalls waiting for the window to clear even
        though actual usage is much smaller. Scaling this to the batch size
        keeps the reservation close to what a batch really needs -- real
        usage is refunded afterward regardless, this only sets the up-front
        hold.
        """
        if kind == "project":
            return settings.groq_max_output  # one call per run; not the bottleneck
        per_file = 230
        return max(500, min(settings.groq_max_output, per_file * settings.batch_size + 220))

    async def structured(
        self,
        system: str,
        prompt: str,
        schema: dict[str, Any],
        name: str,
        effort: str,
        kind: str = "files",
    ) -> dict[str, Any] | None:
        import groq

        assert self._client is not None
        model = self._pick_model(kind)
        budget = _budget_for(model)
        max_output = self._output_reservation(kind)
        cost = estimate_tokens(system) + estimate_tokens(prompt) + max_output

        for attempt in range(3):
            waited = await budget.acquire(cost)
            self.throttled_seconds += waited
            try:
                completion = await self._client.chat.completions.create(
                    model=model,
                    messages=[
                        {"role": "system", "content": system},
                        {"role": "user", "content": prompt},
                    ],
                    response_format={
                        "type": "json_schema",
                        "json_schema": {"name": name, "strict": True, "schema": schema},
                    },
                    max_completion_tokens=max_output,
                    temperature=0.3,
                    **self._kwargs(effort),
                )
                break
            except groq.APIStatusError as exc:
                # 413/429 are the rate limiter talking: wait it out and retry.
                if exc.status_code in (413, 429) and attempt < 2:
                    retry_after = _retry_after(exc)
                    await asyncio.sleep(retry_after)
                    self.throttled_seconds += retry_after
                    continue
                # A strict-schema validation failure usually means the JSON was
                # cut off mid-object: the same call with more room often works.
                if exc.status_code == 400 and "json_validate" in str(exc) and attempt < 2:
                    max_output = int(max_output * 1.6)
                    cost = estimate_tokens(system) + estimate_tokens(prompt) + max_output
                    continue
                self._record_error(_short_error(exc))
                return None
            except groq.APIConnectionError as exc:
                self._record_error(f"Could not reach Groq: {exc}")
                return None
        else:
            return None

        self.calls += 1
        usage = completion.usage
        if usage:
            self.input_tokens += usage.prompt_tokens or 0
            self.output_tokens += usage.completion_tokens or 0
            # Hand back whatever the completion did not use.
            actual = (usage.prompt_tokens or 0) + (usage.completion_tokens or 0)
            budget.refund(cost - actual)

        content = completion.choices[0].message.content or ""
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            self._record_error("Groq returned malformed JSON for one request.")
            return None

    async def stream_text(self, system: str, prompt: str) -> AsyncIterator[str]:
        import groq

        assert self._client is not None
        await _budget_for(self.model).acquire(estimate_tokens(prompt) + 1200)
        try:
            stream = await self._client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": prompt},
                ],
                max_completion_tokens=1200,
                temperature=0.4,
                stream=True,
                **self._kwargs("low"),
            )
            async for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta.content
                if delta:
                    yield delta
        except groq.APIError as exc:
            raise RuntimeError(_short_error(exc)) from exc


def _retry_after(exc: Any) -> float:
    header = getattr(getattr(exc, "response", None), "headers", {}) or {}
    for key in ("retry-after", "x-ratelimit-reset-tokens"):
        raw = header.get(key)
        if not raw:
            continue
        try:
            return min(65.0, float(str(raw).rstrip("s")))
        except ValueError:
            continue
    return 20.0


def _short_error(exc: Any) -> str:
    """Rate-limit errors carry a wall of prose; keep the actionable part."""
    message = str(getattr(exc, "message", exc))
    if "rate_limit_exceeded" in message or "tokens per minute" in message:
        return (
            "Groq rate limit reached (free tier allows 8,000 tokens/minute). "
            "Some files fell back to structural descriptions. Lower "
            "MAX_LLM_FILES, or upgrade the Groq tier for the full city."
        )
    status = getattr(exc, "status_code", "?")
    return f"Groq API error {status}: {message[:180]}"


class AnthropicLLM(LLM):
    provider = "anthropic"

    def __init__(self) -> None:
        super().__init__()
        import anthropic

        self._client = (
            anthropic.AsyncAnthropic(**settings.anthropic_kwargs()) if self.enabled else None
        )

    async def close(self) -> None:
        if self._client is not None:
            await self._client.close()

    async def structured(
        self,
        system: str,
        prompt: str,
        schema: dict[str, Any],
        name: str,
        effort: str,
        kind: str = "files",
    ) -> dict[str, Any] | None:
        import anthropic

        assert self._client is not None
        try:
            async with self._client.messages.stream(
                model=self.model,
                max_tokens=32000,
                system=system,
                thinking={"type": "adaptive"},
                output_config={
                    "effort": effort,
                    "format": {"type": "json_schema", "schema": schema},
                },
                messages=[{"role": "user", "content": prompt}],
            ) as stream:
                message = await stream.get_final_message()
        except anthropic.APIStatusError as exc:
            self._record_error(f"Claude API error {exc.status_code}: {exc.message}")
            return None
        except anthropic.APIConnectionError as exc:
            self._record_error(f"Could not reach the Claude API: {exc}")
            return None

        self.calls += 1
        self.input_tokens += message.usage.input_tokens
        self.output_tokens += message.usage.output_tokens

        if message.stop_reason == "refusal":
            self._record_error("Claude declined to analyze part of this repository.")
            return None

        text = next((b.text for b in message.content if b.type == "text"), "")
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            self._record_error("Claude returned malformed JSON for one request.")
            return None

    async def stream_text(self, system: str, prompt: str) -> AsyncIterator[str]:
        import anthropic

        assert self._client is not None
        try:
            async with self._client.messages.stream(
                model=self.model,
                max_tokens=4000,
                system=system,
                thinking={"type": "adaptive"},
                output_config={"effort": "low"},
                messages=[{"role": "user", "content": prompt}],
            ) as response:
                async for chunk in response.text_stream:
                    yield chunk
        except anthropic.APIError as exc:
            raise RuntimeError(str(exc)) from exc


# Keys that are valid JSON Schema but rejected by the Gemini API.
_GEMINI_UNSUPPORTED = frozenset({"additionalProperties", "$schema", "$id", "$defs"})


def _gemini_schema(schema: Any) -> Any:
    """Recursively strip JSON Schema keys that Gemini's API does not accept."""
    if isinstance(schema, dict):
        return {
            k: _gemini_schema(v)
            for k, v in schema.items()
            if k not in _GEMINI_UNSUPPORTED
        }
    if isinstance(schema, list):
        return [_gemini_schema(item) for item in schema]
    return schema


class GeminiLLM(LLM):
    """Google Gemini via the google-genai SDK.

    The free tier allows 1,000,000 tokens/minute -- effectively unlimited for
    this workload, so there is no TokenBudget here. All file batches fire
    concurrently up to settings.max_concurrency.
    """

    provider = "gemini"

    def __init__(self) -> None:
        super().__init__()
        self.model = settings.gemini_model
        from google import genai

        self._client = (
            genai.Client(api_key=settings.gemini_api_key) if self.enabled else None
        )

    async def structured(
        self,
        system: str,
        prompt: str,
        schema: dict[str, Any],
        name: str,
        effort: str,
        kind: str = "files",
    ) -> dict[str, Any] | None:
        from google.genai import types
        from google.genai.errors import APIError

        assert self._client is not None
        full_prompt = f"{system}\n\n{prompt}"
        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=_gemini_schema(schema),
            temperature=0.3,
        )
        for attempt in range(3):
            try:
                response = await self._client.aio.models.generate_content(
                    model=self.model,
                    contents=full_prompt,
                    config=config,
                )
                break
            except APIError as exc:
                status = getattr(exc, "code", 0)
                if status in (429, 503) and attempt < 2:
                    await asyncio.sleep(5 * (attempt + 1))
                    continue
                self._record_error(f"Gemini API error {status}: {str(exc)[:180]}")
                return None
            except Exception as exc:  # noqa: BLE001
                self._record_error(f"Gemini error: {str(exc)[:180]}")
                return None
        else:
            return None

        self.calls += 1
        usage = response.usage_metadata
        if usage:
            self.input_tokens += getattr(usage, "prompt_token_count", 0) or 0
            self.output_tokens += getattr(usage, "candidates_token_count", 0) or 0

        try:
            return json.loads(response.text)
        except (json.JSONDecodeError, ValueError):
            self._record_error("Gemini returned malformed JSON for one request.")
            return None

    async def stream_text(self, system: str, prompt: str) -> AsyncIterator[str]:
        from google.genai import types

        assert self._client is not None
        full_prompt = f"{system}\n\n{prompt}"
        try:
            async for chunk in await self._client.aio.models.generate_content_stream(
                model=self.model,
                contents=full_prompt,
                config=types.GenerateContentConfig(temperature=0.4),
            ):
                if chunk.text:
                    yield chunk.text
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(f"Gemini stream error: {exc}") from exc


class DisabledLLM(LLM):
    """No key configured: the city still builds, descriptions stay structural."""

    provider = "none"

    def __init__(self) -> None:
        super().__init__()
        self.enabled = False

    async def structured(self, *args: Any, **kwargs: Any) -> None:
        return None

    async def stream_text(self, system: str, prompt: str) -> AsyncIterator[str]:
        yield (
            "The tour guide needs an API key. Add GEMINI_API_KEY (recommended), "
            "GROQ_API_KEY, or ANTHROPIC_API_KEY to backend/.env and restart the server."
        )


def make_llm() -> LLM:
    if not settings.has_llm:
        return DisabledLLM()
    if settings.provider == "gemini":
        return GeminiLLM()
    if settings.provider == "groq":
        return GroqLLM()
    return AnthropicLLM()
