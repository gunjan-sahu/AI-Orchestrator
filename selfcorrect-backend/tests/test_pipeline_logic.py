"""Behavioural tests for the two execution paths, using a scripted fake model (no API key, no network).

They prove the agents really build on each other: the Critic's prompt contains the plan's checks and the
Executor's claims, the Fixer sees the Critic's evidence, and the next Critic round sees the Fixer's reply.
"""
import json
import sqlite3
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, inspect

from app import agents, database, pipeline

TASK = "Explain why the sky appears blue during the day."
PLAN = json.dumps({"approach": "Rayleigh scattering", "steps": ["state the cause", "explain wavelength dependence", "conclude"],
                   "assumptions": ["audience is a layperson"], "risks": ["confusing it with ocean reflection"],
                   "checks": ["mentions Rayleigh scattering", "says shorter wavelengths scatter more"]})


def executor(text="Air molecules scatter short wavelengths more, so the sky looks blue."):
    return (f"<answer>{text}</answer><claims>C1: blue light scatters more than red</claims>"
            "<uncertain>none</uncertain><deviations>none</deviations>")


def critic(verdict="approve", objections=(), rulings=(), verified=("Checked the scattering claim against physics",), risks=()):
    return json.dumps({"verdict": verdict, "verified": list(verified), "objections": list(objections),
                       "rulings": list(rulings), "risks": list(risks)})


def objection(**kw):
    base = {"target": "C1", "severity": "blocking", "type": "fact", "problem": "Cause is misattributed",
            "evidence": "Scattering depends on wavelength^-4, not on ocean reflection", "suggested_fix": "Cite Rayleigh scattering"}
    return {**base, **kw}


def fixer(responses, answer):
    return f"<responses>{json.dumps(responses)}</responses><answer>{answer}</answer>"


class FakeLLM:
    """Replies per agent in order; records every call (role, prompt, kwargs)."""

    def __init__(self, **script):
        self.script = {role: list(replies) for role, replies in script.items()}
        self.calls = []

    def __call__(self, system, prompt, **kw):
        role = {agents.QUICK_SYSTEM: "quick", agents.PLANNER_SYSTEM: "planner", agents.EXECUTOR_SYSTEM: "executor",
                agents.CRITIC_SYSTEM: "critic", agents.FIXER_SYSTEM: "fixer"}[system]
        self.calls.append((role, prompt, kw))
        return self.script[role].pop(0)

    def roles(self):
        return [c[0] for c in self.calls]

    def prompt(self, role, n=0):
        return [c[1] for c in self.calls if c[0] == role][n]


@pytest.fixture
def run(monkeypatch):
    def _run(llm, mode="self_correcting", **kw):
        monkeypatch.setattr(agents, "is_mock", lambda: False)
        monkeypatch.setattr(agents.llm, "complete", llm)
        return pipeline.run_pipeline(TASK, mode, **kw)
    return _run


# ------------------------------------------------------------------ Quick mode
def test_quick_is_one_small_call_with_its_own_prompt(run, monkeypatch):
    monkeypatch.setattr(agents, "settings", SimpleNamespace(llm_provider="anthropic", llm_model="big", llm_quick_model="small"))
    llm = FakeLLM(quick=["The sky is blue because air scatters short wavelengths most (Rayleigh scattering)."])
    result = run(llm, "baseline")
    assert llm.roles() == ["quick"]  # no planner, executor, critic or fixer
    kw = llm.calls[0][2]
    assert kw["model"] == "small" and kw["max_tokens"] <= 700
    assert result.plan == [] and result.iterations == 1
    assert result.trace["format"] == "quick" and result.trace["reviewed"] is False and result.trace["llm_calls"] == 1


# ------------------------------------------------------------------ Verified mode: communication
def test_clean_answer_costs_three_calls_and_no_fixer(run):
    llm = FakeLLM(planner=[PLAN], executor=[executor()], critic=[critic()])
    result = run(llm)
    assert llm.roles() == ["planner", "executor", "critic"]
    report = result.trace["report"]
    assert result.verified and result.iterations == 1 and report["confidence"] == "medium"  # planner assumption is listed
    assert report["decision"] == "approved" and report["stats"]["llm_calls"] == 3


def test_agents_build_on_each_others_outputs(run):
    llm = FakeLLM(planner=[PLAN], executor=[executor("It is the ocean's reflection.")],
                  critic=[critic("revise", [objection()]),
                          critic(rulings=[{"id": "O1", "ruling": "resolved", "reason": "now cites Rayleigh"}])],
                  fixer=[fixer([{"id": "O1", "action": "accept", "reason": "agreed", "change": "cited Rayleigh scattering"}],
                               "Rayleigh scattering sends blue light in all directions.")])
    result = run(llm)
    assert llm.roles() == ["planner", "executor", "critic", "fixer", "critic"]
    assert "confusing it with ocean reflection" in llm.prompt("executor")  # Planner's risks reach the Executor
    assert "mentions Rayleigh scattering" in llm.prompt("critic", 0)  # Planner's checks become the Critic's rubric
    assert "C1: blue light scatters more" in llm.prompt("critic", 0)  # Executor's claims are what gets attacked
    assert "wavelength^-4" in llm.prompt("fixer")  # Fixer receives the Critic's evidence
    assert "cited Rayleigh scattering" in llm.prompt("critic", 1)  # next Critic round sees the Fixer's reply
    assert result.final_output.startswith("Rayleigh") and result.initial_output.startswith("It is the ocean")
    assert (result.issues_found, result.issues_fixed, result.verified) == (1, 1, True)
    fix_msg = [m for m in result.trace["messages"] if m["agent"] == "fixer"][0]
    assert fix_msg["data"]["diff"]["added"] >= 1 and not fix_msg["data"]["diff"]["unchanged"]  # a real diff, not a claim


# ------------------------------------------------------------------ Verified mode: Critic effectiveness
def test_objection_without_evidence_cannot_trigger_a_fix_cycle(run):
    vague = objection(evidence="", problem="Could be more thorough")
    llm = FakeLLM(planner=[PLAN], executor=[executor()], critic=[critic("revise", [vague])])
    result = run(llm)
    assert "fixer" not in llm.roles() and result.iterations == 1
    assert any("unsubstantiated" in r["text"] for r in result.trace["report"]["unresolved_risks"])


def test_minor_objection_is_reported_not_fixed(run):
    llm = FakeLLM(planner=[PLAN], executor=[executor()],
                  critic=[critic("approve", [objection(severity="minor", problem="Slightly informal wording")])])
    result = run(llm)
    assert "fixer" not in llm.roles() and result.verified
    assert any(r["kind"] == "minor" for r in result.trace["report"]["unresolved_risks"])


def test_unreadable_critic_reply_is_disclosed_not_hidden(run):
    llm = FakeLLM(planner=[PLAN], executor=[executor()], critic=["sorry, no JSON today"])
    result = run(llm)
    risks = [r["text"] for r in result.trace["report"]["unresolved_risks"]]
    assert any("unreadable" in t for t in risks) and result.trace["report"]["confidence"] != "high"


# ------------------------------------------------------------------ Verified mode: disagreement
def test_fixer_can_rebut_and_critic_can_withdraw(run):
    llm = FakeLLM(planner=[PLAN], executor=[executor()],
                  critic=[critic("revise", [objection(severity="major")]),
                          critic(rulings=[{"id": "O1", "ruling": "withdrawn", "reason": "Fixer is right"}])],
                  fixer=[fixer([{"id": "O1", "action": "reject", "reason": "C1 is correct as stated", "change": ""}],
                               executor())])
    result = run(llm)
    assert llm.roles() == ["planner", "executor", "critic", "fixer", "critic"]
    assert "C1 is correct as stated" in llm.prompt("critic", 1)
    obj = result.trace["objections"][0]
    assert obj["status"] == "withdrawn" and result.verified
    assert result.issues_found == 0  # a withdrawn objection was not a real issue


def test_unresolved_dispute_stops_and_is_shown_to_the_user(run):
    reject = fixer([{"id": "O1", "action": "reject", "reason": "I stand by C1", "change": ""}], executor())
    llm = FakeLLM(planner=[PLAN], executor=[executor()],
                  critic=[critic("revise", [objection()]),
                          critic("revise", rulings=[{"id": "O1", "ruling": "upheld", "reason": "still wrong"}])],
                  fixer=[reject, reject])
    result = run(llm, max_iterations=5)
    assert llm.roles() == ["planner", "executor", "critic", "fixer", "critic", "fixer"]  # no endless ping-pong
    report = result.trace["report"]
    assert report["decision"] == "contested" and not result.verified and report["confidence"] == "low"
    assert any(r["kind"] == "contested" and "I stand by C1" in r["text"] for r in report["unresolved_risks"])


def test_deterministic_failure_overrides_a_lenient_critic_and_cannot_be_argued_away(monkeypatch):
    wrong = "<answer>2 + 3 * 4 = 20\nAnswer: 20</answer><claims>C1: 2+3*4=20</claims><uncertain>none</uncertain><deviations>none</deviations>"
    llm = FakeLLM(planner=[PLAN], executor=[wrong], critic=[critic()],  # the LLM Critic wrongly approves
                  fixer=[fixer([{"id": "V-math", "action": "reject", "reason": "20 is right", "change": ""}], "2 + 3 * 4 = 20\nAnswer: 20")])
    monkeypatch.setattr(agents, "is_mock", lambda: False)
    monkeypatch.setattr(agents.llm, "complete", llm)
    result = pipeline.run_pipeline("What is 2 + 3 * 4?")
    obj = result.trace["objections"][0]
    assert obj["id"] == "V-math" and obj["source"] == "verifier" and obj["status"] == "open"
    assert not result.verified and result.trace["report"]["decision"] == "stuck"
    assert llm.roles() == ["planner", "executor", "critic", "fixer"]


def test_round_limit_is_respected(run):
    obj = lambda n: critic("revise", [objection(problem=f"Issue {n}")])  # noqa: E731
    fix_n = lambda n: fixer([{"id": f"O{n}", "action": "accept", "reason": "ok", "change": "edit"}], f"version {n}")  # noqa: E731
    llm = FakeLLM(planner=[PLAN], executor=[executor()], critic=[obj(1), obj(2)], fixer=[fix_n(1)])
    result = run(llm, max_iterations=2)
    assert llm.roles() == ["planner", "executor", "critic", "fixer", "critic"]
    assert result.iterations == 2 and result.trace["report"]["decision"] == "max_rounds" and not result.verified


# ------------------------------------------------------------------ persistence + API
def test_old_databases_get_the_trace_column(monkeypatch, tmp_path):
    path = tmp_path / "old.db"
    sqlite3.connect(path).executescript("CREATE TABLE tasks (id INTEGER PRIMARY KEY, prompt TEXT);")
    engine = create_engine(f"sqlite:///{path}")
    monkeypatch.setattr(database, "engine", engine)
    database._add_missing_columns()
    database._add_missing_columns()  # idempotent
    assert "trace" in {c["name"] for c in inspect(engine).get_columns("tasks")}


def test_api_returns_different_shapes_for_each_mode(client, auth):
    quick = client.post("/api/tasks", json={"prompt": "What is 2 + 3 * 4?", "mode": "baseline"}, headers=auth).json()
    full = client.post("/api/tasks", json={"prompt": "What is 2 + 3 * 4?"}, headers=auth).json()
    assert quick["trace"]["format"] == "quick" and "report" not in quick["trace"]
    report = full["trace"]["report"]
    assert full["trace"]["format"] == "pipeline" and report["decision"] == "approved" and report["corrections"]
    assert [m["agent"] for m in full["trace"]["messages"]] == ["planner", "executor", "critic", "fixer", "critic"]
    assert full["trace"]["objections"][0]["source"] == "verifier" and full["trace"]["objections"][0]["status"] == "resolved"
    assert client.get(f"/api/tasks/{full['id']}", headers=auth).json()["trace"]["report"]["decision"] == "approved"


def test_stream_events_carry_real_summaries(client, auth):
    with client.stream("POST", "/api/tasks/stream", json={"prompt": "What is 2 + 3 * 4?"}, headers=auth) as r:
        lines = [json.loads(x) for x in r.iter_lines() if x]
    critic_done = [m for m in lines if m.get("agent") == "critic" and m.get("state") == "done"][0]
    assert critic_done["objections"] and "serious objection" in critic_done["summary"]


# ------------------------------------------------------------------ executable checks (opt-in sandbox)
from app import sandbox, verifiers  # noqa: E402


def test_sandbox_runs_limits_and_hides_the_environment(monkeypatch):
    monkeypatch.setenv("SOME_SECRET_TOKEN", "hunter2")
    ok = sandbox.run_python("import os\nprint(ANSWER.upper(), os.environ.get('SOME_SECRET_TOKEN'))", answer="abc")
    assert ok["ok"] and ok["output"] == "ABC None"
    assert not sandbox.run_python("assert 1 == 2")["ok"]
    slow = sandbox.run_python("while True: pass", timeout=1)
    assert slow["timed_out"] and not slow["ok"]


def test_answers_own_tests_are_executed_only_when_enabled(monkeypatch):
    bad = "```python\ndef add(a, b):\n    return a - b\n\nassert add(2, 3) == 5\n```"
    good = bad.replace("a - b", "a + b")
    monkeypatch.setattr(sandbox, "enabled", lambda: False)
    assert verifiers.verify(TASK, bad) == [] or all(f["key"] != "V-run" for f in verifiers.verify(TASK, bad))
    monkeypatch.setattr(sandbox, "enabled", lambda: True)
    assert any(f["key"] == "V-run" and "AssertionError" in f["evidence"] for f in verifiers.verify(TASK, bad))
    assert all(f["key"] != "V-run" for f in verifiers.verify(TASK, good))


def test_critic_executes_a_check_and_real_output_becomes_evidence(run, monkeypatch):
    monkeypatch.setattr(sandbox, "enabled", lambda: True)
    check = "n = len(ANSWER.split())\nprint('PASS' if n == 5 else f'FAIL: answer has {n} words, expected 5')"
    llm = FakeLLM(planner=[PLAN], executor=[executor("Rain falls softly.")],
                  critic=[json.dumps({"verdict": "approve", "verified": ["read it"], "check_code": check}),  # lenient verdict
                          json.dumps({"verdict": "approve", "verified": ["recounted"], "check_code": check})],
                  fixer=[fixer([{"id": "O1", "action": "accept", "reason": "miscounted", "change": "added words"}],
                               "Rain falls softly on rooftops.")])
    result = run(llm)
    assert "EXECUTION TOOL" in llm.prompt("critic", 0)
    first = result.trace["objections"][0]
    assert first["executed"] and "answer has 3 words" in first["evidence"] and first["status"] == "resolved"
    assert llm.roles() == ["planner", "executor", "critic", "fixer", "critic"] and result.verified
    assert any("Executed an independent check" in v for v in result.trace["messages"][-1]["data"]["verified"])


def test_execution_tool_is_not_advertised_when_disabled(run):
    llm = FakeLLM(planner=[PLAN], executor=[executor()], critic=[critic()])
    run(llm)
    assert "EXECUTION TOOL" not in llm.prompt("critic", 0)  # no wasted prompt tokens


def test_a_crashing_check_is_a_risk_not_an_accusation(run, monkeypatch):
    monkeypatch.setattr(sandbox, "enabled", lambda: True)
    llm = FakeLLM(planner=[PLAN], executor=[executor()],
                  critic=[json.dumps({"verdict": "approve", "verified": ["x"], "check_code": "raise RuntimeError('boom')"})])
    result = run(llm)
    assert result.verified and "fixer" not in llm.roles()
    assert any("could not be used" in r["text"] for r in result.trace["report"]["unresolved_risks"])
