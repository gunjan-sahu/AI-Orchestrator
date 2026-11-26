"""Two genuinely different execution paths behind one entry point.

* ``baseline`` (Quick):    ONE model call, no plan, no review. Output = a short answer.
* ``self_correcting`` (Verified): Planner -> Executor -> Critic -> (Fixer -> Critic ...) driven by an objection ledger.
  A Fixer round happens only while a serious, evidence-backed objection is still actionable. Output = answer + a
  report of contributions, objections, corrections, unresolved risks and a confidence level.
"""
import time
from dataclasses import dataclass, field

from app import agents, verifiers
from app.config import settings
from app.ledger import Ledger, confidence, diff_stats


@dataclass
class PipelineResult:
    plan: list = field(default_factory=list)
    initial_output: str = ""
    final_output: str = ""
    verified: bool = False
    steps: list = field(default_factory=list)  # dicts: number, output, verdict, issues
    issues_found: int = 0
    issues_fixed: int = 0
    iterations: int = 0
    latency_ms: int = 0
    trace: dict | None = None  # Quick: small meta dict. Verified: agent messages + objections + report.


def run_pipeline(task: str, mode: str = "self_correcting", max_iterations: int | None = None, on_event=None) -> PipelineResult:
    """on_event(dict) is called as each agent starts/finishes, so callers can stream REAL progress."""
    emit = on_event or (lambda _e: None)
    started = time.perf_counter()
    if mode == "baseline":
        result = _run_quick(task, emit)
    else:
        result = _run_verified(task, max_iterations or settings.max_iterations, emit)
    result.iterations = len(result.steps)
    result.latency_ms = int((time.perf_counter() - started) * 1000)
    return result


# ====================================================================== Quick
def _run_quick(task: str, emit) -> PipelineResult:
    emit({"agent": "executor", "state": "start", "summary": "Answering directly"})
    t0 = time.perf_counter()
    output = agents.quick(task)
    emit({"agent": "executor", "state": "done", "summary": "Answered"})
    # Deterministic check only *measures* the result so both modes can be compared fairly; it never changes it.
    issues = verifiers.run_verifiers(task, output)
    result = PipelineResult(initial_output=output, final_output=output, verified=not issues, issues_found=len(issues))
    result.steps = [{"number": 1, "output": output, "verdict": "fail" if issues else "pass", "issues": issues}]
    result.trace = {"format": "quick", "llm_calls": 0 if agents.is_mock() else 1, "reviewed": False,
                    "model": "rule-based" if agents.is_mock() else agents.quick_model(),
                    "answer_ms": int((time.perf_counter() - t0) * 1000)}
    return result


# ====================================================================== Verified
def _msg(messages: list, agent: str, rnd: int, kind: str, summary: str, started: float, **data) -> dict:
    m = {"seq": len(messages) + 1, "agent": agent, "round": rnd, "kind": kind, "summary": summary,
         "ms": int((time.perf_counter() - started) * 1000), "data": data}
    messages.append(m)
    return m


def _label(o: dict) -> str:
    return f"[{o['severity']}] {o['problem']}"


def _run_verified(task: str, max_rounds: int, emit) -> PipelineResult:
    result, ledger, messages = PipelineResult(), Ledger(), []
    calls = 0  # real model calls made (0 in the offline mock engine)

    def count() -> None:
        nonlocal calls
        calls += 0 if agents.is_mock() else 1

    # ---- Planner: strategy + acceptance checks + risks (the Executor and the Critic both consume these)
    emit({"agent": "planner", "state": "start", "summary": "Planning the approach and acceptance checks"})
    t0 = time.perf_counter()
    plan = agents.plan(task)
    count()
    result.plan = plan["steps"]
    summary = f"{len(plan['steps'])} steps, {len(plan['checks'])} acceptance checks, {len(plan['risks'])} risks flagged"
    _msg(messages, "planner", 0, "plan", summary, t0, **plan)
    emit({"agent": "planner", "state": "done", "steps": len(plan["steps"]), "summary": summary})

    # ---- Executor: follows the plan, declares the claims it relies on and where it was unsure
    emit({"agent": "executor", "state": "start", "summary": "Writing a first draft from the plan"})
    t0 = time.perf_counter()
    draft = agents.execute(task, plan)
    count()
    output = result.initial_output = draft["answer"]
    summary = (f"Draft written; relies on {len(draft['claims'])} claims, "
               f"{len(draft['uncertain'])} uncertainties, {len(draft['deviations'])} plan deviations")
    _msg(messages, "executor", 0, "draft", summary, t0, claims=draft["claims"], uncertain=draft["uncertain"],
         deviations=draft["deviations"])
    emit({"agent": "executor", "state": "done", "summary": summary})

    last_review: dict = {"verdict": "revise", "verified": [], "risks": []}
    decision = "max_rounds"
    for rnd in range(1, max_rounds + 1):
        # ---- Critic: deterministic ground truth first, then an evidence-based model review
        emit({"agent": "critic", "state": "start", "round": rnd,
              "summary": "Critic re-checking the fix and the objections" if rnd > 1 else "Critic testing the draft against the plan"})
        t0 = time.perf_counter()
        findings = verifiers.verify(task, output)
        ledger.sync_verifier(findings, rnd)
        prior = ledger.prompt_view() if rnd > 1 else None
        review = agents.critique(task, plan, draft, output, findings, prior, rnd)
        count()
        ledger.apply_rulings(review["rulings"], rnd)
        raised = ledger.add_critic_objections(review["objections"], rnd)
        last_review = review
        actionable = ledger.actionable()
        verifier_open = [i for i in ledger.items.values() if i["source"] == "verifier" and i["status"] == "open"]
        summary = (f"{len(actionable)} serious objection(s) standing"
                   + (f" ({len(raised)} new, {len(review['rulings'])} ruled on)" if rnd > 1
                      else f" ({len(raised)} from the Critic, {len(verifier_open)} from deterministic checks)")
                   if actionable else "No serious objections; approved")
        _msg(messages, "critic", rnd, "review", summary, t0, verdict=review["verdict"], verified=review["verified"],
             risks=review["risks"], rulings=review["rulings"], raised=[i["id"] for i in raised],
             verifier_findings=[i["id"] for i in verifier_open], parsed=review["parsed"])
        unresolved = ledger.unresolved_serious()
        result.steps.append({"number": rnd, "output": output, "verdict": "fail" if unresolved else "pass",
                             "issues": [_label(o) for o in unresolved]})
        emit({"agent": "critic", "state": "done", "round": rnd, "issues": len(actionable),
              "objections": [_label(o) for o in actionable], "summary": summary})

        if not actionable:  # nothing a Fixer round could change: approved, or only contested items remain
            decision = "approved" if not unresolved else "contested"
            break
        if rnd == max_rounds:
            decision = "max_rounds"
            break

        # ---- Fixer: answers every objection (accept / reject with reasoning / partial) and revises
        emit({"agent": "fixer", "state": "start", "round": rnd,
              "summary": f"Fixer responding to {len(actionable)} objection(s)"})
        t0 = time.perf_counter()
        fixed = agents.fix(task, plan, output, actionable)
        count()
        ledger.apply_fixer(fixed["responses"])
        diff = diff_stats(output, fixed["answer"])
        acts = [r["action"] for r in fixed["responses"]]
        summary = (f"{acts.count('accept')} accepted, {acts.count('partial')} partial, {acts.count('reject')} rejected; "
                   + ("answer unchanged" if diff["unchanged"] else f"+{diff['added']}/-{diff['removed']} lines"))
        _msg(messages, "fixer", rnd, "response", summary, t0, responses=fixed["responses"], diff=diff)
        emit({"agent": "fixer", "state": "done", "round": rnd, "summary": summary,
              "accepted": acts.count("accept"), "rejected": acts.count("reject")})

        # A rebuttal only counts if the ledger kept it (rejecting a deterministic finding is ignored).
        rebutted = any(ledger.items[r["id"]]["status"] in ("disputed", "contested")
                       for r in fixed["responses"] if r["id"] in ledger.items)
        if diff["unchanged"] and not rebutted:  # claimed a fix but changed nothing: another round would just repeat
            decision = "stuck"
            break
        if diff["unchanged"] and not ledger.actionable():  # only contested items left and nothing changed: stop here
            decision = "contested"
            break
        output = fixed["answer"]

    result.final_output = output
    result.issues_found, result.issues_fixed = ledger.counts()
    unresolved = ledger.unresolved_serious()
    approved = last_review["verdict"] == "approve" and not unresolved
    result.verified = approved

    # ---- final report: what each agent contributed and what is still uncertain
    risks = _unresolved_risks(ledger, plan, draft, last_review)
    mock_unreviewed = agents.is_mock() and not verifiers.extract_expression(task)
    level, reason = confidence(ledger, approved, len(last_review["verified"]), [r["text"] for r in risks], mock_unreviewed)
    report = {
        "confidence": level, "confidence_reason": reason, "decision": decision,
        "verified_checks": last_review["verified"],
        "corrections": [{"id": o["id"], "problem": o["problem"], "action": o["fixer_action"], "change": o["change"],
                         "status": o["status"]} for o in ledger.items.values() if o["fixer_action"] and o["status"] != "withdrawn"],
        "unresolved_risks": risks,
        "stats": {"llm_calls": calls, "rounds": len(result.steps), "objections": len(ledger.items),
                  "found": result.issues_found, "resolved": result.issues_fixed,
                  "withdrawn": sum(1 for o in ledger.items.values() if o["status"] == "withdrawn")},
    }
    result.trace = {"format": "pipeline", "messages": messages, "objections": ledger.export(), "report": report}
    return result


def _unresolved_risks(ledger: Ledger, plan: dict, draft: dict, review: dict) -> list[dict]:
    risks = []
    for o in ledger.items.values():
        if o["status"] in ("open", "disputed") and o["severity"] in ("blocking", "major"):
            risks.append({"kind": "open_objection", "text": f"{o['problem']} (evidence: {o['evidence']})"})
        elif o["status"] == "contested":
            risks.append({"kind": "contested", "text": f"Critic and Fixer disagree: {o['problem']}. "
                          f"Fixer's position: {o['fixer_reason'] or 'rejected'}"})
        elif o["severity"] == "minor" and o["status"] not in ("resolved", "withdrawn"):
            risks.append({"kind": "minor", "text": o["problem"]})
    risks += [{"kind": "critic_risk", "text": t} for t in review.get("risks", [])]
    risks += [{"kind": "executor_uncertainty", "text": t} for t in draft.get("uncertain", [])
              if not t.startswith("Offline mock")]
    risks += [{"kind": "assumption", "text": t} for t in plan.get("assumptions", [])]
    return risks
