"""Runtime configuration, loaded from environment / .env file."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "") or default)
    except ValueError:
        return default


def _default_provider() -> str:
    """Whichever key is present wins; Groq first because it is the faster demo."""
    explicit = (os.getenv("LLM_PROVIDER") or "").strip().lower()
    if explicit in {"groq", "anthropic"}:
        return explicit
    if os.getenv("GROQ_API_KEY"):
        return "groq"
    return "anthropic"


@dataclass
class Settings:
    # --- Credentials (put these in backend/.env; the app boots without them
    #     and tells you what is missing when you try to analyze) ---
    provider: str = field(default_factory=_default_provider)
    groq_api_key: str = field(default_factory=lambda: os.getenv("GROQ_API_KEY", ""))
    anthropic_api_key: str = field(default_factory=lambda: os.getenv("ANTHROPIC_API_KEY", ""))
    github_token: str = field(default_factory=lambda: os.getenv("GITHUB_TOKEN", ""))

    # Point an SDK somewhere else (a gateway, or tests/mock_anthropic.py).
    anthropic_base_url: str = field(default_factory=lambda: os.getenv("ANTHROPIC_BASE_URL", ""))
    groq_base_url: str = field(default_factory=lambda: os.getenv("GROQ_BASE_URL", ""))

    # --- Models ---
    # gpt-oss-120b: 131k context, strict JSON-schema support, and the strongest
    # code comprehension of the chat models Groq currently serves.
    groq_model: str = field(
        default_factory=lambda: os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
    )
    # Groq meters tokens per model, not per account, so spreading the file
    # batches over two models roughly doubles the throughput available on the
    # free tier. The briefing always uses the primary (largest) model.
    groq_file_models: str = field(
        default_factory=lambda: os.getenv(
            "GROQ_FILE_MODELS", "openai/gpt-oss-120b,openai/gpt-oss-20b"
        )
    )
    anthropic_model: str = field(
        default_factory=lambda: os.getenv("CLAUDE_MODEL", "claude-opus-5")
    )

    # Effort trades depth for latency. "medium" keeps a live demo snappy;
    # bump to "high" for richer write-ups.
    _file_effort: str = field(default_factory=lambda: os.getenv("FILE_EFFORT", ""))
    _project_effort: str = field(default_factory=lambda: os.getenv("PROJECT_EFFORT", ""))

    # --- Groq rate limiting -------------------------------------------------
    # The free tier allows 8,000 tokens/minute and counts the requested
    # completion size too, so both numbers matter. Raise them on a paid tier.
    groq_tpm: int = field(default_factory=lambda: _int("GROQ_TPM", 8000))
    groq_max_output: int = field(default_factory=lambda: _int("GROQ_MAX_OUTPUT", 1800))

    # --- Budgets: keep a big repo from turning into a 40-minute analysis ---
    max_buildings: int = field(default_factory=lambda: _int("MAX_BUILDINGS", 320))
    _max_llm_files: int = field(default_factory=lambda: _int("MAX_LLM_FILES", 0))
    _batch_size: int = field(default_factory=lambda: _int("LLM_BATCH_SIZE", 0))
    _max_concurrency: int = field(default_factory=lambda: _int("LLM_CONCURRENCY", 0))
    _file_char_budget: int = field(default_factory=lambda: _int("FILE_CHAR_BUDGET", 0))

    cache_dir: Path = field(default_factory=lambda: ROOT / ".cache")
    cors_origins: list[str] = field(
        default_factory=lambda: (
            os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
        )
    )

    # Defaults differ by provider: Groq's free minute is small, so we send
    # compact sketches of fewer files; Claude can take whole files in bulk.
    @property
    def file_models(self) -> list[str]:
        models = [m.strip() for m in self.groq_file_models.split(",") if m.strip()]
        return models or [self.groq_model]

    # Reasoning tokens are billed as output, so effort is a throughput dial on
    # a metered tier, not just a quality one.
    @property
    def file_effort(self) -> str:
        return self._file_effort or ("low" if self.provider == "groq" else "medium")

    @property
    def project_effort(self) -> str:
        return self._project_effort or ("medium" if self.provider == "groq" else "high")

    @property
    def max_llm_files(self) -> int:
        return self._max_llm_files or (40 if self.provider == "groq" else 120)

    @property
    def batch_size(self) -> int:
        return self._batch_size or (4 if self.provider == "groq" else 10)

    @property
    def max_concurrency(self) -> int:
        return self._max_concurrency or (3 if self.provider == "groq" else 6)

    @property
    def file_char_budget(self) -> int:
        return self._file_char_budget or (1700 if self.provider == "groq" else 6000)

    @property
    def api_key(self) -> str:
        return self.groq_api_key if self.provider == "groq" else self.anthropic_api_key

    @property
    def model(self) -> str:
        return self.groq_model if self.provider == "groq" else self.anthropic_model

    @property
    def has_llm(self) -> bool:
        return bool(self.api_key)

    def anthropic_kwargs(self) -> dict[str, str]:
        kwargs = {"api_key": self.anthropic_api_key}
        if self.anthropic_base_url:
            kwargs["base_url"] = self.anthropic_base_url
        return kwargs

    def groq_kwargs(self) -> dict[str, str]:
        kwargs = {"api_key": self.groq_api_key}
        if self.groq_base_url:
            kwargs["base_url"] = self.groq_base_url
        return kwargs


settings = Settings()
settings.cache_dir.mkdir(parents=True, exist_ok=True)
