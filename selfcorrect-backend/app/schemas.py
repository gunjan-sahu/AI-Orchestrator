"""Request/response models. Pydantic validates every incoming field automatically."""
import re
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=100)]
Prompt = Annotated[str, StringConstraints(strip_whitespace=True, min_length=5, max_length=4000)]
Mode = Literal["self_correcting", "baseline"]


def _clean_email(value: str) -> str:
    value = value.strip().lower()
    if not EMAIL_RE.match(value):
        raise ValueError("Enter a valid email address")
    return value


class RegisterIn(BaseModel):
    email: str = Field(max_length=255, examples=["student@example.com"])
    full_name: Name = Field(examples=["Asha Verma"])
    password: str = Field(min_length=8, max_length=128, examples=["Passw0rd123"])

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        return _clean_email(v)

    @field_validator("password")
    @classmethod
    def _password_strength(cls, v: str) -> str:
        if not (re.search(r"[A-Za-z]", v) and re.search(r"\d", v)):
            raise ValueError("Password must contain at least one letter and one number")
        return v


class LoginIn(BaseModel):
    email: str = Field(max_length=255)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        return v.strip().lower()


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: str
    full_name: str
    created_at: datetime


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int = Field(description="Seconds until the token expires")
    user: UserOut


class TaskIn(BaseModel):
    prompt: Prompt = Field(examples=["What is 2 + 3 * 4?"])
    mode: Mode = "self_correcting"
    max_iterations: int | None = Field(default=None, ge=1, le=5, description="Max Critic rounds (default from .env)")


class StepOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    number: int
    output: str
    verdict: str
    issues: list[str]


class TaskSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    prompt: str
    mode: str
    verified: bool
    iterations: int
    issues_found: int
    issues_fixed: int
    latency_ms: int
    created_at: datetime


class TaskOut(TaskSummary):
    plan: list[str]
    initial_output: str
    final_output: str
    provider: str
    steps: list[StepOut]


class TaskList(BaseModel):
    items: list[TaskSummary]
    total: int
    limit: int
    offset: int
