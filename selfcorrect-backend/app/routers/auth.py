"""Registration, login and 'who am I' endpoints."""
from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import get_current_user
from app.errors import AppError
from app.models import User
from app.schemas import LoginIn, RegisterIn, TokenOut, UserOut
from app.security import DUMMY_HASH, create_access_token, hash_password, login_limiter, verify_password

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/register", response_model=UserOut, status_code=201, summary="Create an account")
def register(body: RegisterIn, db: Session = Depends(get_db)):
    if db.scalar(select(User).where(User.email == body.email)):
        raise AppError(409, "email_taken", "An account with this email already exists.")
    user = User(email=body.email, full_name=body.full_name, password_hash=hash_password(body.password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError:  # two requests registering the same email at once
        db.rollback()
        raise AppError(409, "email_taken", "An account with this email already exists.") from None
    return user


@router.post("/login", response_model=TokenOut, summary="Log in and receive a JWT")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    key = request.client.host if request.client else "unknown"
    login_limiter.check(key)
    user = db.scalar(select(User).where(User.email == body.email))
    valid = verify_password(body.password, user.password_hash if user else DUMMY_HASH)
    if user is None or not valid:
        login_limiter.hit(key)
        raise AppError(401, "invalid_credentials", "Incorrect email or password.")
    login_limiter.reset(key)
    return TokenOut(
        access_token=create_access_token(user.id),
        expires_in=settings.token_expire_minutes * 60,
        user=UserOut.model_validate(user),
    )


@router.get("/me", response_model=UserOut, summary="Current user profile")
def me(user: User = Depends(get_current_user)):
    return user
