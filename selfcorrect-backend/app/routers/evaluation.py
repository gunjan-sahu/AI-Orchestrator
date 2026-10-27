"""Evaluation plan from the project: accuracy, error reduction, correction rate and latency overhead."""
from fastapi import APIRouter, Depends
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app import verifiers
from app.config import settings
from app.database import get_db
from app.deps import get_current_user
from app.errors import AppError
from app.llm import LLMError
from app.models import Task, User
from app.pipeline import run_pipeline

router = APIRouter(prefix="/evaluation", tags=["Evaluation"])

BENCHMARK_TASKS = [
    "Calculate 2 + 3 * 4",
    "What is 10 - 4 / 2 + 6 * 3?",
    "Compute 100 / 5 * 2 + 3 ^ 2",
    "Evaluate (8 + 2) * 5 - 3",
    "Solve 7 + 6 * 5 - 8 / 4",
    "What is 18 / 3 + 4 * 2?",
]
MODES = ("baseline", "self_correcting")


def _pct(part: int, whole: int) -> float | None:
    return round(100 * part / whole, 1) if whole else None


@router.get("/stats", summary="Your saved results, baseline vs self-correcting")
def stats(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.execute(
        select(
            Task.mode, func.count(Task.id), func.sum(case((Task.verified.is_(True), 1), else_=0)),
            func.avg(Task.latency_ms), func.avg(Task.iterations),
            func.sum(Task.issues_found), func.sum(Task.issues_fixed),
        ).where(Task.user_id == user.id).group_by(Task.mode)
    ).all()
    by_mode = {m: {"tasks": 0, "verified_rate_pct": None, "avg_latency_ms": None, "avg_iterations": None,
                   "issues_found": 0, "issues_fixed": 0, "correction_rate_pct": None} for m in MODES}
    for mode, count, verified, latency, iters, found, fixed in rows:
        found, fixed = int(found or 0), int(fixed or 0)
        by_mode[mode] = {
            "tasks": count, "verified_rate_pct": _pct(int(verified or 0), count),
            "avg_latency_ms": round(latency or 0, 1), "avg_iterations": round(iters or 0, 2),
            "issues_found": found, "issues_fixed": fixed, "correction_rate_pct": _pct(fixed, found),
        }
    return {"total_tasks": sum(m["tasks"] for m in by_mode.values()), "by_mode": by_mode}


@router.post("/benchmark", summary="Run a built-in task set through both modes and compare")
def benchmark(_: User = Depends(get_current_user)):
    rows = []
    try:
        for task in BENCHMARK_TASKS:
            row = {"task": task, "expected": verifiers.fmt(verifiers.expected_answer(task))}
            for mode in MODES:
                res = run_pipeline(task, mode)
                row[mode] = {"answer": verifiers.extract_answer(res.final_output),
                             "correct": verifiers.is_correct(task, res.final_output),
                             "iterations": res.iterations, "latency_ms": res.latency_ms}
            rows.append(row)
    except LLMError as exc:
        raise AppError(502, "llm_error", str(exc)) from None

    n = len(rows)
    base_ok = sum(r["baseline"]["correct"] for r in rows)
    sc_ok = sum(r["self_correcting"]["correct"] for r in rows)
    errors_before = n - base_ok
    rescued = sum(1 for r in rows if not r["baseline"]["correct"] and r["self_correcting"]["correct"])
    avg = lambda mode: round(sum(r[mode]["latency_ms"] for r in rows) / n, 1)  # noqa: E731
    return {
        "provider": settings.llm_provider,
        "summary": {
            "tasks": n,
            "accuracy_pct": {"baseline": _pct(base_ok, n), "self_correcting": _pct(sc_ok, n)},
            "errors_before_correction": errors_before,
            "errors_after_correction": n - sc_ok,
            "correction_rate_pct": _pct(rescued, errors_before),
            "avg_latency_ms": {"baseline": avg("baseline"), "self_correcting": avg("self_correcting")},
            "latency_overhead_ms": round(avg("self_correcting") - avg("baseline"), 1),
        },
        "results": rows,
    }
