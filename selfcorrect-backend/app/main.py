"""FastAPI application entry point: app setup, error handlers and routers."""
import logging
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import settings
from app.database import get_db, init_db
from app.errors import AppError, error_body
from app.routers import auth, evaluation, tasks

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("selfcorrect")

DESCRIPTION = """
Backend for the **Self-Correcting Multi-Agent AI Pipeline** mini project.

A task goes through four agents - **Planner -> Executor -> Critic -> Fixer** - and the answer is
re-checked until it passes or the iteration limit is reached.

**How to use this page:** register -> login -> copy the `access_token` -> click **Authorize** -> try `POST /api/tasks`.
"""


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    log.info("Ready | llm_provider=%s | model=%s | database=%s", settings.llm_provider, settings.llm_model,
             make_url(settings.database_url).get_backend_name())
    yield


app = FastAPI(title="Self-Correcting Multi-Agent AI Pipeline", version="1.0.0", description=DESCRIPTION,
              lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["*"])


# ------------------------------------------------------------------ error handlers
@app.exception_handler(AppError)
async def app_error_handler(_: Request, exc: AppError):
    return JSONResponse(status_code=exc.status_code, content=error_body(exc.code, exc.message), headers=exc.headers)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError):
    details = [{"field": ".".join(str(p) for p in e["loc"] if p != "body"),
                "message": e["msg"].removeprefix("Value error, ")} for e in exc.errors()]
    return JSONResponse(status_code=422, content=error_body("validation_error", "Request validation failed.", details))


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(_: Request, exc: StarletteHTTPException):
    codes = {404: "not_found", 405: "method_not_allowed"}
    return JSONResponse(status_code=exc.status_code, content=error_body(codes.get(exc.status_code, "http_error"),
                                                                       str(exc.detail)))


@app.exception_handler(Exception)
async def unhandled_error_handler(request: Request, exc: Exception):
    log.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content=error_body("server_error", "Something went wrong on the server."))


# ------------------------------------------------------------------ routes
app.include_router(auth.router, prefix="/api")
app.include_router(tasks.router, prefix="/api")
app.include_router(evaluation.router, prefix="/api")


@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse("/app/index.html")


@app.get("/api/health", tags=["System"], summary="Health check")
def health(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
        db_status = "ok"
    except Exception:  # noqa: BLE001
        db_status = "unavailable"
    body = {"status": "ok" if db_status == "ok" else "degraded", "database": db_status,
            "llm_provider": settings.llm_provider}
    return JSONResponse(status_code=200 if db_status == "ok" else 503, content=body)


# The web interface (plain HTML/CSS/JS in ./frontend) is served at /app. Missing pages get frontend/404.html.
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
if FRONTEND_DIR.is_dir():
    app.mount("/app", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
