"""Thin client for the language-model API. Supports Anthropic and any OpenAI-compatible server."""
import logging
import time

import httpx

from app.config import settings

log = logging.getLogger("selfcorrect")
_RETRY_STATUS = {429, 500, 502, 503, 529}


class LLMError(Exception):
    """The language-model service failed or returned something unusable."""


def complete(system: str, prompt: str) -> str:
    """Send one prompt to the configured model and return its text reply."""
    provider = settings.llm_provider
    if provider == "anthropic":
        url = f"{settings.llm_base_url}/v1/messages"
        headers = {"x-api-key": settings.llm_api_key, "anthropic-version": "2023-06-01"}
        payload = {"model": settings.llm_model, "max_tokens": 2048, "system": system,
                   "messages": [{"role": "user", "content": prompt}]}
    elif provider == "openai":
        url = f"{settings.llm_base_url}/chat/completions"
        headers = {"Authorization": f"Bearer {settings.llm_api_key}"} if settings.llm_api_key else {}
        payload = {"model": settings.llm_model, "max_tokens": 2048,
                   "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}]}
    else:
        raise LLMError("No language model is configured (LLM_PROVIDER=mock).")

    last_error = "unknown error"
    response = None
    for attempt in range(2):
        try:
            response = httpx.post(url, headers=headers, json=payload, timeout=settings.llm_timeout)
        except httpx.HTTPError as exc:
            last_error = f"Could not reach the LLM service ({exc.__class__.__name__})."
        else:
            if response.status_code == 200:
                break
            last_error = f"LLM service returned HTTP {response.status_code}."
            log.warning("LLM error body: %s", response.text[:300])
            if response.status_code not in _RETRY_STATUS:
                raise LLMError(last_error)
        response = None
        if attempt == 0:
            time.sleep(1)
    if response is None:
        raise LLMError(last_error)

    try:
        data = response.json()
        if provider == "anthropic":
            return "".join(b.get("text", "") for b in data["content"] if b.get("type") == "text").strip()
        return data["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError, ValueError):
        raise LLMError("The LLM service returned an unexpected response format.") from None
