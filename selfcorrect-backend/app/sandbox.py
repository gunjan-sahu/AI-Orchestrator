"""Best-effort sandbox for running model-written Python checks (Verified mode only, opt-in).

WARNING: this executes code written by a language model. It is OFF by default (ALLOW_CODE_EXECUTION=false).
Enable it only on a machine you control. Protections applied: separate interpreter in isolated mode, temporary
working directory, minimal environment, CPU / memory / file-size limits, a hard timeout, and (on Linux, when
`unshare` works) no network. That is hardening, not a security boundary: do not expose it to untrusted users.
"""
import os
import shutil
import subprocess
import sys
import tempfile

from app.config import settings

OUT_LIMIT = 800
_net_prefix: list | None = None


def enabled() -> bool:
    return bool(getattr(settings, "allow_code_execution", False))


def _limits() -> None:  # runs in the child process before the interpreter starts (POSIX only)
    import resource
    resource.setrlimit(resource.RLIMIT_CPU, (6, 6))
    resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024,) * 2)
    resource.setrlimit(resource.RLIMIT_FSIZE, (1_000_000,) * 2)
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))


def _network_isolation() -> list:
    global _net_prefix
    if _net_prefix is None:
        _net_prefix = []
        if os.name == "posix" and shutil.which("unshare"):
            try:
                if subprocess.run(["unshare", "-rn", "true"], capture_output=True, timeout=3).returncode == 0:
                    _net_prefix = ["unshare", "-rn"]
            except (OSError, subprocess.SubprocessError):
                pass
    return _net_prefix


def run_python(code: str, answer: str | None = None, timeout: int = 5) -> dict:
    """Run `code`; if `answer` is given it is available to the code as the string variable ANSWER."""
    header = f"ANSWER = {answer!r}\n" if answer is not None else ""
    env = {k: os.environ[k] for k in ("PATH", "SYSTEMROOT") if k in os.environ}
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "check.py")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(header + code)
        try:
            proc = subprocess.run(_network_isolation() + [sys.executable, "-I", path], cwd=tmp, env=env,
                                  capture_output=True, text=True, timeout=timeout,
                                  preexec_fn=_limits if os.name == "posix" else None)
        except subprocess.TimeoutExpired:
            return {"ok": False, "timed_out": True, "output": f"Did not finish within {timeout}s."}
        except OSError as exc:
            return {"ok": False, "timed_out": False, "output": f"Could not run: {exc.__class__.__name__}"}
    text = ((proc.stdout or "") + (proc.stderr or "")).strip()
    return {"ok": proc.returncode == 0, "timed_out": False, "output": text[-OUT_LIMIT:]}
