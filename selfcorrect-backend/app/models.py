"""Database tables: User -> Task -> IterationLog (one row per Critic round)."""
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utcnow() -> datetime:
    """Current UTC time (stored as naive UTC)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(100))
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    tasks: Mapped[list["Task"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    prompt: Mapped[str] = mapped_column(Text)
    mode: Mapped[str] = mapped_column(String(20), index=True)  # self_correcting | baseline
    plan: Mapped[list] = mapped_column(JSON, default=list)
    initial_output: Mapped[str] = mapped_column(Text)
    final_output: Mapped[str] = mapped_column(Text)
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    iterations: Mapped[int] = mapped_column(Integer, default=1)
    issues_found: Mapped[int] = mapped_column(Integer, default=0)
    issues_fixed: Mapped[int] = mapped_column(Integer, default=0)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    provider: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    user: Mapped[User] = relationship(back_populates="tasks")
    steps: Mapped[list["IterationLog"]] = relationship(
        back_populates="task", cascade="all, delete-orphan", order_by="IterationLog.number"
    )


class IterationLog(Base):
    __tablename__ = "iteration_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    number: Mapped[int] = mapped_column(Integer)
    output: Mapped[str] = mapped_column(Text)
    verdict: Mapped[str] = mapped_column(String(10))  # pass | fail
    issues: Mapped[list] = mapped_column(JSON, default=list)

    task: Mapped[Task] = relationship(back_populates="steps")
