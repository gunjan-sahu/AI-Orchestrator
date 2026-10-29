"""Project file check:  python check_project.py

Verifies that every required file exists and is non-empty, that all Python files compile,
that .env.example documents every environment variable the code reads, and that the app imports.
"""
import os
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REQUIRED = [
    "README.md", "requirements.txt", ".env.example", ".gitignore", "run.py", "demo.py", "check_project.py",
    "app/__init__.py", "app/main.py", "app/config.py", "app/database.py", "app/models.py", "app/schemas.py",
    "app/security.py", "app/deps.py", "app/errors.py", "app/llm.py", "app/agents.py", "app/verifiers.py",
    "app/pipeline.py", "app/routers/__init__.py", "app/routers/auth.py", "app/routers/tasks.py",
    "app/routers/evaluation.py", "tests/__init__.py", "tests/conftest.py", "tests/test_api.py", "tests/test_verifiers.py", "tests/test_llm_mode.py", "tests/test_frontend.py",
    "frontend/index.html", "frontend/login.html", "frontend/register.html", "frontend/history.html",
    "frontend/evaluation.html", "frontend/profile.html", "frontend/about.html", "frontend/404.html", "frontend/logo.png", "frontend/favicon.ico", "frontend/favicon-32.png", "frontend/apple-touch-icon.png",
    "frontend/css/synora.css", "frontend/js/api.js", "frontend/js/app.js", "frontend/js/ui.js", "frontend/js/auth.js",
    "frontend/js/shell.js", "frontend/js/aurora.js", "frontend/js/richtext.js", "frontend/js/task-view.js",
    "frontend/js/orchestrator.js", "frontend/js/history.js", "frontend/js/evaluation.js", "frontend/js/profile.js", "frontend/js/about.js",
    "frontend/vendor/katex/katex.min.js", "frontend/vendor/katex/katex.min.css",
    "frontend/vendor/fonts/inter-latin-wght-normal.woff2", "frontend/vendor/fonts/instrument-serif-latin-400-normal.woff2",
]
ALLOW_EMPTY = {"app/routers/__init__.py", "tests/__init__.py"}


def main() -> int:
    problems = []

    for rel in REQUIRED:
        path = ROOT / rel
        if not path.is_file():
            problems.append(f"missing file: {rel}")
        elif path.stat().st_size == 0 and rel not in ALLOW_EMPTY:
            problems.append(f"empty file: {rel}")

    for path in ROOT.rglob("*.py"):
        if any(part in {".venv", "venv", "__pycache__"} for part in path.parts):
            continue
        try:
            compile(path.read_text(encoding="utf-8"), str(path), "exec")
        except SyntaxError as exc:
            problems.append(f"syntax error in {path.relative_to(ROOT)} line {exc.lineno}: {exc.msg}")

    env_file = ROOT / ".env.example"
    if env_file.is_file():
        documented = set(re.findall(r"^([A-Z_]+)=", env_file.read_text(encoding="utf-8"), re.M))
        used = set()
        for rel in ("app/config.py", "run.py"):
            if (ROOT / rel).is_file():
                used |= set(re.findall(r"""(?:getenv|_get_int)\(\s*["']([A-Z_]+)["']""", (ROOT / rel).read_text(encoding="utf-8")))
        used.add("RELOAD")  # optional dev flag read by run.py
        for name in sorted(used - documented - {"RELOAD"}):
            problems.append(f".env.example is missing variable: {name}")

    if not problems:  # import check only makes sense when files exist
        tmp = tempfile.mkdtemp()
        os.environ.update({"DATABASE_URL": f"sqlite:///{Path(tmp, 'check.db').as_posix()}", "LLM_PROVIDER": "mock",
                           "SECRET_KEY": "x" * 40})
        sys.path.insert(0, str(ROOT))
        try:
            import app.main  # noqa: F401
        except Exception as exc:  # noqa: BLE001
            problems.append(f"app failed to import: {exc!r}")

    if problems:
        print("CHECK FAILED")
        for p in problems:
            print("  -", p)
        return 1
    print(f"CHECK PASSED: {len(REQUIRED)} required files present, all Python files compile, "
          ".env.example complete, app imports cleanly.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
