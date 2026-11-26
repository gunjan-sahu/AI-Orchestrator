"""Tests the real-model code paths (Anthropic/OpenAI) using fake HTTP responses - no API key needed."""
from types import SimpleNamespace

import pytest

from app import llm


def fake_settings(provider):
    return SimpleNamespace(llm_provider=provider, llm_base_url="https://example.test", llm_api_key="k",
                           llm_model="m", llm_timeout=5, max_iterations=3)


class FakeResponse:
    def __init__(self, status, data=None):
        self.status_code, self._data, self.text = status, data or {}, "body"

    def json(self):
        return self._data


def test_anthropic_response_is_parsed(monkeypatch):
    monkeypatch.setattr(llm, "settings", fake_settings("anthropic"))
    monkeypatch.setattr(llm.httpx, "post", lambda *a, **k: FakeResponse(200, {"content": [{"type": "text", "text": " hi "}]}))
    assert llm.complete("sys", "prompt") == "hi"


def test_openai_response_is_parsed(monkeypatch):
    monkeypatch.setattr(llm, "settings", fake_settings("openai"))
    monkeypatch.setattr(llm.httpx, "post", lambda *a, **k: FakeResponse(200, {"choices": [{"message": {"content": "ok"}}]}))
    assert llm.complete("sys", "prompt") == "ok"


def test_llm_errors_become_llmerror(monkeypatch):
    monkeypatch.setattr(llm, "settings", fake_settings("anthropic"))
    monkeypatch.setattr(llm.time, "sleep", lambda s: None)
    monkeypatch.setattr(llm.httpx, "post", lambda *a, **k: FakeResponse(401))
    with pytest.raises(llm.LLMError):
        llm.complete("s", "p")
    calls = []
    monkeypatch.setattr(llm.httpx, "post", lambda *a, **k: calls.append(1) or FakeResponse(503))
    with pytest.raises(llm.LLMError):
        llm.complete("s", "p")
    assert len(calls) == 2  # one retry on a temporary failure
    monkeypatch.setattr(llm.httpx, "post", lambda *a, **k: FakeResponse(200, {"unexpected": True}))
    with pytest.raises(llm.LLMError):
        llm.complete("s", "p")


def test_per_call_overrides_reach_the_request(monkeypatch):
    sent = {}
    monkeypatch.setattr(llm, "settings", fake_settings("openai"))
    monkeypatch.setattr(llm.httpx, "post", lambda url, headers, json, timeout: sent.update(json) or FakeResponse(200, {"choices": [{"message": {"content": "ok"}}]}))
    llm.complete("s", "p", max_tokens=700, temperature=0.2, model="small")
    assert sent["model"] == "small" and sent["max_tokens"] == 700 and sent["temperature"] == 0.2
    sent.clear()
    llm.complete("s", "p")  # defaults are unchanged for existing callers
    assert sent["model"] == "m" and sent["max_tokens"] == 2048 and "temperature" not in sent
