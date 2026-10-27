"""Application settings, read once from environment variables (a .env file is supported)."""
import logging
import os
import secrets
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()
log = logging.getLogger("selfcorrect")

VALID_PROVIDERS = ("mock", "anthropic", "openai")
DEFAULT_BASE_URLS = {"anthropic": "https://api.anthropic.com", "openai": "https://api.openai.com/v1"}
DEFAULT_MODELS = {"anthropic": "claude-sonnet-5-5", "openai": "gpt-4o-mini", "mock": "rule-based"}


class ConfigError(RuntimeError):
    """Raised when the environment configuration is invalid."""


def _get_int(name: str, default: int, minimum: int = 1) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        raise ConfigError(f"{name} must be an integer, got {raw!r}") from None
    if value < minimum:
        raise ConfigError(f"{name} must be >= {minimum}")
    return value


@dataclass(frozen=True)
class Settings:
    database_url: str
    secret_key: str
    token_expire_minutes: int
    llm_provider: str
    llm_model: str
    llm_api_key: str
    llm_base_url: str
    llm_timeout: int
    max_iterations: int
    login_max_attempts: int
    cors_origins: list


def load_settings() -> Settings:
    provider = os.getenv("LLM_PROVIDER", "mock").strip().lower()
    if provider not in VALID_PROVIDERS:
        raise ConfigError(f"LLM_PROVIDER must be one of {VALID_PROVIDERS}, got {provider!r}")

    api_key = os.getenv("LLM_API_KEY", "").strip()
    if provider == "anthropic" and not api_key:
        raise ConfigError("LLM_PROVIDER=anthropic requires LLM_API_KEY to be set in .env")

    secret = os.getenv("SECRET_KEY", "").strip()
    if not secret or secret.startswith("change-me"):
        secret = secrets.token_hex(32)
        log.warning("SECRET_KEY not set - using a temporary key. Logins will reset on restart. "
                    "Set a permanent value in .env (see README).")
    elif len(secret) < 32:
        raise ConfigError("SECRET_KEY must be at least 32 characters long")

    origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]

    return Settings(
        database_url=os.getenv("DATABASE_URL", "sqlite:///./data/selfcorrect.db").strip(),
        secret_key=secret,
        token_expire_minutes=_get_int("TOKEN_EXPIRE_MINUTES", 60),
        llm_provider=provider,
        llm_model=os.getenv("LLM_MODEL", "").strip() or DEFAULT_MODELS[provider],
        llm_api_key=api_key,
        llm_base_url=(os.getenv("LLM_BASE_URL", "").strip() or DEFAULT_BASE_URLS.get(provider, "")).rstrip("/"),
        llm_timeout=_get_int("LLM_TIMEOUT_SECONDS", 60),
        max_iterations=_get_int("MAX_ITERATIONS", 3),
        login_max_attempts=_get_int("LOGIN_MAX_ATTEMPTS", 10),
        cors_origins=origins or ["*"],
    )


settings = load_settings()
