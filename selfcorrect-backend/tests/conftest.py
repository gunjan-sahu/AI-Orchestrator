"""Test setup: use a throw-away database and the offline mock engine (set BEFORE importing the app)."""
import os
import sys
import tempfile
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ["DATABASE_URL"] = f"sqlite:///{Path(tempfile.mkdtemp(), 'test.db').as_posix()}"
os.environ["LLM_PROVIDER"] = "mock"
os.environ["SECRET_KEY"] = "t" * 40

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

PASSWORD = "Passw0rd123"


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


def make_user(client):
    email = f"user{uuid.uuid4().hex[:8]}@example.com"
    r = client.post("/api/auth/register", json={"email": email, "full_name": "Test User", "password": PASSWORD})
    assert r.status_code == 201, r.text
    token = client.post("/api/auth/login", json={"email": email, "password": PASSWORD}).json()["access_token"]
    return email, {"Authorization": f"Bearer {token}"}


@pytest.fixture
def auth(client):
    return make_user(client)[1]
