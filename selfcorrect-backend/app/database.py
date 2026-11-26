"""Database engine and session handling (SQLAlchemy 2.x, SQLite by default)."""
import os

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

_is_sqlite = settings.database_url.startswith("sqlite")
engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if _is_sqlite else {},
    pool_pre_ping=True,
)


if _is_sqlite:
    @event.listens_for(engine, "connect")
    def _enable_foreign_keys(dbapi_conn, _record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    """FastAPI dependency: one database session per request, always closed afterwards."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Create the data folder (SQLite) and all tables if they do not exist yet."""
    from app import models  # noqa: F401  (registers the tables)

    if _is_sqlite:
        path = make_url(settings.database_url).database
        if path and path != ":memory:":
            os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    Base.metadata.create_all(bind=engine)
    _add_missing_columns()


def _add_missing_columns() -> None:
    """Tiny forward-only migration: databases created before `tasks.trace` existed get the column added."""
    columns = {c["name"] for c in inspect(engine).get_columns("tasks")}
    if "trace" not in columns:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN trace JSON"))
