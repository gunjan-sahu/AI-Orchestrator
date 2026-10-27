"""Reusable FastAPI dependencies."""
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.errors import AppError
from app.models import User
from app.security import decode_token

_bearer = HTTPBearer(auto_error=False)


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    if creds is None:
        raise AppError(401, "not_authenticated", "Missing bearer token. Log in first.", {"WWW-Authenticate": "Bearer"})
    user = db.get(User, decode_token(creds.credentials))
    if user is None:
        raise AppError(401, "invalid_token", "The account for this token no longer exists.",
                       {"WWW-Authenticate": "Bearer"})
    return user
