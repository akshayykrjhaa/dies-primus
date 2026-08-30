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
    """Whichever key is present wins; Gemini first (generous free tier)."""
    explicit = (os.getenv("LLM_PROVIDER") or "").strip().lower()
    if explicit in {"groq", "anthropic", "gemini"}:
        return explicit
    if os.getenv("GEMINI_API_KEY"):
        return "gemini"
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
    gemini_api_key: str = field(default_factory=lambda: os.getenv("GEMINI_API_KEY", ""))
    github_token: str = field(default_factory=lambda: os.getenv("GITHUB_TOKEN", ""))

    # --- GitHub OAuth (per-user "Connect GitHub" login) ---------------------
    # Create an OAuth App at https://github.com/settings/developers. The
    # callback URL must match GITHUB_OAUTH_REDIRECT_URI exactly.
    github_client_id: str = field(default_factory=lambda: os.getenv("GITHUB_CLIENT_ID", ""))
    github_client_secret: str = field(
        default_factory=lambda: os.getenv("GITHUB_CLIENT_SECRET", "")
    )
    # Dev default routes through the Vite proxy (localhost:5173) rather than
    # straight to the API port, so the session cookie lands on the same
    # origin the frontend calls /api on. Point this at the API port instead
    # for a single-origin build (see start.ps1 -BuildOnly).
    github_oauth_redirect_uri: str = field(
        default_factory=lambda: os.getenv(
            "GITHUB_OAUTH_REDIRECT_URI", "http://localhost:5173/api/auth/github/callback"
        )
    )
    # "repo" is required to read private repositories; drop it to "read:user"
    # for a public-repos-only deployment.
    github_oauth_scopes: str = field(
        default_factory=lambda: os.getenv("GITHUB_OAUTH_SCOPES", "read:user repo")
    )
    frontend_url: str = field(
        default_factory=lambda: os.getenv("FRONTEND_URL", "http://localhost:5173")
    )
    # Set true once the app is served over HTTPS so session cookies get the
    # Secure flag. False by default so local http:// dev keeps working.
    session_cookie_secure: bool = field(
        default_factory=lambda: (os.getenv("SESSION_COOKIE_SECURE", "").strip().lower()
                                  in {"1", "true", "yes"})
    )

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
    gemini_model: str = field(
        default_factory=lambda: os.getenv("GEMINI_MODEL", "gemini-3.6-flash")
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
    #: -1 means "use the provider default"; 0 means "describe nothing eagerly".
    _eager_files: int = field(default_factory=lambda: _int("EAGER_FILES", -1))
    _batch_size: int = field(default_factory=lambda: _int("LLM_BATCH_SIZE", 0))
    _max_concurrency: int = field(default_factory=lambda: _int("LLM_CONCURRENCY", 0))
    _file_char_budget: int = field(default_factory=lambda: _int("FILE_CHAR_BUDGET", 0))
    _chat_context_chars: int = field(default_factory=lambda: _int("CHAT_CONTEXT_CHARS", 0))

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
    def eager_files(self) -> int:
        """How many files are described *before* the city opens.

        Describing every candidate up front was the whole cost of an analysis:
        120 files at 6,000 characters is roughly 180,000 input tokens, on every
        run, for a visitor who will click maybe five buildings. Only the most
        important handful are now described eagerly -- enough to give the
        briefing something to stand on -- and the rest are described the moment
        somebody actually opens one. Set EAGER_FILES=0 to make the city open
        instantly with no per-file calls at all.
        """
        if self._eager_files >= 0:
            return self._eager_files
        return 8 if self.provider == "groq" else 14

    @property
    def batch_size(self) -> int:
        return self._batch_size or (4 if self.provider == "groq" else 10)

    @property
    def max_concurrency(self) -> int:
        return self._max_concurrency or (3 if self.provider == "groq" else 8)

    @property
    def file_char_budget(self) -> int:
        # `sketch.py` has already reduced the file to its imports, declarations
        # and doc lines, so the extra thousands of characters were mostly body
        # the model did not need. Trimming this is the cheapest token saving
        # available: it scales linearly with every file sent.
        return self._file_char_budget or (1700 if self.provider == "groq" else 2200)

    @property
    def chat_context_chars(self) -> int:
        """How much of the city index the tour guide is handed per question.

        The guide answers from a briefing built out of the analysed city:
        every district, plus the most important couple of hundred buildings
        with a line each. On a repository of any size that is around fifty
        thousand characters -- some twelve thousand tokens -- which is fine
        for a provider that meters a million tokens a minute and impossible
        for one that meters eight thousand. On Groq's free tier the request
        was larger than the entire per-minute allowance, so the guide could
        not answer a single question: every attempt came back as a rate limit,
        and waiting did not help because the next attempt was the same size.

        Sized to the provider like the other budgets here. The briefing is
        built most-important-first and stops at this many characters, so a
        smaller allowance means fewer buildings named rather than a truncated
        sentence -- and the guide is told how many it did not see, so it says
        it does not know instead of assuming the repository is that small.
        """
        return self._chat_context_chars or (20000 if self.provider == "groq" else 90000)

    @property
    def api_key(self) -> str:
        if self.provider == "groq":
            return self.groq_api_key
        if self.provider == "gemini":
            return self.gemini_api_key
        return self.anthropic_api_key

    @property
    def model(self) -> str:
        if self.provider == "groq":
            return self.groq_model
        if self.provider == "gemini":
            return self.gemini_model
        return self.anthropic_model

    @property
    def has_llm(self) -> bool:
        return bool(self.api_key)

    @property
    def has_github_oauth(self) -> bool:
        return bool(self.github_client_id and self.github_client_secret)

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
