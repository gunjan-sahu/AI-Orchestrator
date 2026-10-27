"""Run the AI pipeline on a task and manage the saved task history."""
from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import get_current_user
from app.errors import AppError
from app.llm import LLMError
from app.models import IterationLog, Task, User
from app.pipeline import run_pipeline
from app.schemas import Mode, TaskIn, TaskList, TaskOut

router = APIRouter(prefix="/tasks", tags=["Tasks"])


def _own_task(db: Session, user: User, task_id: int) -> Task:
    task = db.get(Task, task_id)
    if task is None or task.user_id != user.id:  # same answer for "missing" and "not yours"
        raise AppError(404, "task_not_found", f"Task {task_id} was not found.")
    return task


@router.post("", response_model=TaskOut, status_code=201, summary="Run a task through the pipeline")
def create_task(body: TaskIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        result = run_pipeline(body.prompt, body.mode, body.max_iterations)
    except LLMError as exc:
        raise AppError(502, "llm_error", str(exc)) from None
    task = Task(
        user_id=user.id, prompt=body.prompt, mode=body.mode, plan=result.plan,
        initial_output=result.initial_output, final_output=result.final_output, verified=result.verified,
        iterations=result.iterations, issues_found=result.issues_found, issues_fixed=result.issues_fixed,
        latency_ms=result.latency_ms, provider=settings.llm_provider,
        steps=[IterationLog(number=s["number"], output=s["output"], verdict=s["verdict"], issues=s["issues"])
               for s in result.steps],
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


@router.get("", response_model=TaskList, summary="List your tasks (newest first)")
def list_tasks(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    mode: Mode | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = select(Task).where(Task.user_id == user.id)
    if mode:
        query = query.where(Task.mode == mode)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    items = db.scalars(query.order_by(Task.id.desc()).limit(limit).offset(offset)).all()
    return TaskList(items=items, total=total, limit=limit, offset=offset)


@router.get("/{task_id}", response_model=TaskOut, summary="Task details with every Critic round")
def get_task(task_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _own_task(db, user, task_id)


@router.delete("/{task_id}", status_code=204, summary="Delete a task")
def delete_task(task_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.delete(_own_task(db, user, task_id))
    db.commit()
    return Response(status_code=204)
