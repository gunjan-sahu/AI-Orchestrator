"""Tests the real-model code paths (Anthropic/OpenAI) using fake HTTP responses - no API key needed."""
from types import SimpleNamespace

import pytest

from app import agents, llm, pipeline


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


def test_full_pipeline_with_fake_llm(monkeypatch):
    """Executor is wrong, LLM Critic and deterministic checks object, Fixer repairs it."""
    def fake_complete(system, prompt):
        if system == agents.PLANNER_SYSTEM:
            return "1. Read the task\n2) Apply precedence\n- Answer"
        if system == agents.EXECUTOR_SYSTEM:
            return "2 + 3 * 4 = 20\nAnswer: 20"
        if system == agents.CRITIC_SYSTEM:
            return 'Sure! {"verdict": "fail", "issues": ["Multiplication must come first"]}' if "Answer: 20" in prompt \
                else '{"verdict": "pass", "issues": []}'
        return "2 + 3 * 4 = 14\nAnswer: 14"

    monkeypatch.setattr(agents, "_mock", lambda: False)
    monkeypatch.setattr(agents.llm, "complete", fake_complete)
    result = pipeline.run_pipeline("What is 2 + 3 * 4?")
    assert result.plan == ["Read the task", "Apply precedence", "Answer"]
    assert result.verified and result.iterations == 2 and "Answer: 14" in result.final_output
    assert any("Multiplication" in i for i in result.steps[0]["issues"])  # LLM issue merged with the math check
    assert result.issues_found == result.issues_fixed == 2


def test_unparseable_critic_reply_does_not_crash():
    assert agents._parse_critic("no json here") is None
    assert agents._parse_critic('{"verdict": "fail"}') == ["The critic judged the answer to be incorrect."]
