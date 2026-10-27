"""Password hashing, JWT tokens and a small brute-force limiter. Uses only well-known primitives."""
import hashlib
import hmac
import os
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

import jwt

from app.config import settings
from app.errors import AppError

_ITERATIONS = 200_000


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _ITERATIONS)
    return f"pbkdf2_sha256${_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, iterations, salt_hex, digest_hex = stored.split("$")
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(iterations))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(digest.hex(), digest_hex)


# Used to spend the same time on unknown emails as on wrong passwords.
DUMMY_HASH = hash_password("dummy-password-1")


def create_access_token(user_id: int) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + timedelta(minutes=settings.token_expire_minutes),
    }
    return jwt.encode(payload, settings.secret_key, algorithm="HS256")


def decode_token(token: str) -> int:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"], options={"require": ["exp", "sub"]})
        return int(payload["sub"])
    except jwt.ExpiredSignatureError:
        raise AppError(401, "token_expired", "Your session has expired. Please log in again.",
                       {"WWW-Authenticate": "Bearer"}) from None
    except (jwt.PyJWTError, ValueError):
        raise AppError(401, "invalid_token", "Invalid authentication token.",
                       {"WWW-Authenticate": "Bearer"}) from None


class FailedLoginLimiter:
    """Blocks a client after too many failed logins within a time window (in memory)."""

    def __init__(self, limit: int, window_seconds: int = 300):
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque] = defaultdict(deque)

    def _prune(self, key: str) -> deque:
        q = self._hits[key]
        cutoff = time.monotonic() - self.window
        while q and q[0] < cutoff:
            q.popleft()
        return q

    def check(self, key: str) -> None:
        if len(self._prune(key)) >= self.limit:
            raise AppError(429, "too_many_attempts", "Too many failed login attempts. Try again in a few minutes.")

    def hit(self, key: str) -> None:
        self._prune(key).append(time.monotonic())

    def reset(self, key: str) -> None:
        self._hits.pop(key, None)


login_limiter = FailedLoginLimiter(settings.login_max_attempts)
