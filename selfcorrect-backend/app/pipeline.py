"""Orchestrator: runs the Planner -> Executor -> Critic -> Fixer loop (or the one-step baseline)."""
import time
from dataclasses import dataclass, field

from app import agents, verifiers
from app.config import settings


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


def run_pipeline(task: str, mode: str = "self_correcting", max_iterations: int | None = None, on_event=None) -> PipelineResult:
    """on_event(dict) is called as each agent starts/finishes, so callers can stream REAL progress."""
    emit = on_event or (lambda _e: None)
    max_iterations = max_iterations or settings.max_iterations
    started = time.perf_counter()
    result = PipelineResult()

    if mode == "baseline":
        # One-step AI: no plan, no critic, no fixer. An independent deterministic check only
        # *measures* the result so both modes can be compared fairly.
        emit({"agent": "executor", "state": "start"})
        output = agents.execute(task, [])
        emit({"agent": "executor", "state": "done"})
        issues = verifiers.run_verifiers(task, output)
        result.initial_output = result.final_output = output
        result.steps = [{"number": 1, "output": output, "verdict": "fail" if issues else "pass", "issues": issues}]
        result.verified = not issues
        result.issues_found = len(issues)
    else:
        emit({"agent": "planner", "state": "start"})
        result.plan = agents.plan(task)
        emit({"agent": "planner", "state": "done", "steps": len(result.plan)})
        emit({"agent": "executor", "state": "start"})
        output = agents.execute(task, result.plan)
        emit({"agent": "executor", "state": "done"})
        result.initial_output = output
        issues: list[str] = []
        for number in range(1, max_iterations + 1):
            emit({"agent": "critic", "state": "start", "round": number})
            issues = agents.critique(task, output)
            emit({"agent": "critic", "state": "done", "round": number, "issues": len(issues)})
            result.steps.append({"number": number, "output": output,
                                 "verdict": "fail" if issues else "pass", "issues": issues})
            if not issues:
                result.verified = True
                break
            result.issues_found += len(issues)
            if number == max_iterations:
                break
            emit({"agent": "fixer", "state": "start", "round": number})
            revised = agents.fix(task, output, issues)
            emit({"agent": "fixer", "state": "done", "round": number})
            if revised.strip() == output.strip():
                break  # the Fixer could not improve the answer; stop instead of looping
            output = revised
        result.final_output = output
        result.issues_fixed = result.issues_found - len(issues)

    result.iterations = len(result.steps)
    result.latency_ms = int((time.perf_counter() - started) * 1000)
    return result
