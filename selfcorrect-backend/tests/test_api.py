from app.security import login_limiter
from tests.conftest import PASSWORD, make_user


# ------------------------------------------------------------------ system
def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_unknown_route_uses_standard_error_shape(client):
    r = client.get("/api/nope")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"


# ------------------------------------------------------------------ auth
def test_register_and_duplicate(client):
    body = {"email": "Dup@Example.com", "full_name": "  Dup User ", "password": PASSWORD}
    r = client.post("/api/auth/register", json=body)
    assert r.status_code == 201
    data = r.json()
    assert data["email"] == "dup@example.com" and data["full_name"] == "Dup User" and "password" not in str(data)
    assert client.post("/api/auth/register", json=body).status_code == 409


def test_register_validation(client):
    bad_password = {"email": "a@example.com", "full_name": "Abc", "password": "onlyletters"}
    r = client.post("/api/auth/register", json=bad_password)
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
    assert client.post("/api/auth/register", json={**bad_password, "password": PASSWORD, "email": "nope"}).status_code == 422
    assert client.post("/api/auth/register", json={"email": "a@example.com"}).status_code == 422


def test_login_and_me(client):
    email, headers = make_user(client)
    me = client.get("/api/auth/me", headers=headers)
    assert me.status_code == 200 and me.json()["email"] == email


def test_login_wrong_password(client):
    email, _ = make_user(client)
    r = client.post("/api/auth/login", json={"email": email, "password": "WrongPass999"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "invalid_credentials"
    login_limiter.reset("testclient")


def test_protected_routes_need_valid_token(client):
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/tasks").status_code == 401
    bad = client.get("/api/auth/me", headers={"Authorization": "Bearer not.a.token"})
    assert bad.status_code == 401 and bad.json()["error"]["code"] == "invalid_token"


def test_login_rate_limit(client):
    old = login_limiter.limit
    login_limiter.limit = 3
    login_limiter.reset("testclient")
    try:
        for _ in range(3):
            assert client.post("/api/auth/login", json={"email": "x@example.com", "password": "bad"}).status_code == 401
        assert client.post("/api/auth/login", json={"email": "x@example.com", "password": "bad"}).status_code == 429
    finally:
        login_limiter.limit = old
        login_limiter.reset("testclient")


# ------------------------------------------------------------------ pipeline
def test_self_correcting_fixes_wrong_first_answer(client, auth):
    r = client.post("/api/tasks", json={"prompt": "What is 2 + 3 * 4?"}, headers=auth)
    assert r.status_code == 201
    t = r.json()
    assert "Answer: 20" in t["initial_output"]  # naive first draft is wrong
    assert "Answer: 14" in t["final_output"]  # Critic caught it, Fixer repaired it
    assert t["verified"] is True and t["iterations"] == 2
    assert t["issues_found"] == 1 and t["issues_fixed"] == 1
    assert [s["verdict"] for s in t["steps"]] == ["fail", "pass"]
    assert len(t["plan"]) == 3


def test_baseline_keeps_wrong_answer(client, auth):
    t = client.post("/api/tasks", json={"prompt": "What is 2 + 3 * 4?", "mode": "baseline"}, headers=auth).json()
    assert "Answer: 20" in t["final_output"] and t["verified"] is False
    assert t["iterations"] == 1 and t["plan"] == [] and t["issues_fixed"] == 0


def test_correct_first_time_passes_in_one_round(client, auth):
    t = client.post("/api/tasks", json={"prompt": "Evaluate (8 + 2) * 5 - 3"}, headers=auth).json()
    assert t["verified"] is True and t["iterations"] == 1 and t["issues_found"] == 0


def test_non_math_task_runs(client, auth):
    r = client.post("/api/tasks", json={"prompt": "Explain what a database index is"}, headers=auth)
    assert r.status_code == 201 and r.json()["verified"] is True


def test_iteration_limit_is_respected(client, auth):
    t = client.post("/api/tasks", json={"prompt": "What is 2 + 3 * 4?", "max_iterations": 1}, headers=auth).json()
    assert t["iterations"] == 1 and t["verified"] is False and t["issues_fixed"] == 0


def test_task_validation(client, auth):
    for body in ({"prompt": "hi"}, {"prompt": "What is 1 + 1?", "mode": "bogus"},
                 {"prompt": "What is 1 + 1?", "max_iterations": 9}, {}):
        assert client.post("/api/tasks", json=body, headers=auth).status_code == 422


# ------------------------------------------------------------------ history
def test_list_get_delete_and_isolation(client, auth):
    ids = [client.post("/api/tasks", json={"prompt": f"What is {n} + 1 * 2?"}, headers=auth).json()["id"]
           for n in (1, 2, 3)]
    page = client.get("/api/tasks?limit=2", headers=auth).json()
    assert page["total"] == 3 and len(page["items"]) == 2 and page["items"][0]["id"] == ids[-1]
    assert client.get("/api/tasks?mode=baseline", headers=auth).json()["total"] == 0
    assert client.get("/api/tasks?limit=0", headers=auth).status_code == 422

    detail = client.get(f"/api/tasks/{ids[0]}", headers=auth)
    assert detail.status_code == 200 and len(detail.json()["steps"]) >= 1

    other = make_user(client)[1]  # another user must not see these tasks
    assert client.get(f"/api/tasks/{ids[0]}", headers=other).status_code == 404
    assert client.delete(f"/api/tasks/{ids[0]}", headers=other).status_code == 404

    assert client.delete(f"/api/tasks/{ids[0]}", headers=auth).status_code == 204
    r = client.get(f"/api/tasks/{ids[0]}", headers=auth)
    assert r.status_code == 404 and r.json()["error"]["code"] == "task_not_found"


# ------------------------------------------------------------------ evaluation
def test_stats(client, auth):
    client.post("/api/tasks", json={"prompt": "What is 2 + 3 * 4?"}, headers=auth)
    client.post("/api/tasks", json={"prompt": "What is 2 + 3 * 4?", "mode": "baseline"}, headers=auth)
    s = client.get("/api/evaluation/stats", headers=auth).json()
    assert s["total_tasks"] == 2
    sc, base = s["by_mode"]["self_correcting"], s["by_mode"]["baseline"]
    assert sc["verified_rate_pct"] == 100.0 and sc["correction_rate_pct"] == 100.0
    assert base["verified_rate_pct"] == 0.0


def test_benchmark_shows_improvement(client, auth):
    r = client.post("/api/evaluation/benchmark", headers=auth)
    assert r.status_code == 200
    summary = r.json()["summary"]
    assert summary["accuracy_pct"]["self_correcting"] == 100.0
    assert summary["accuracy_pct"]["baseline"] < summary["accuracy_pct"]["self_correcting"]
    assert summary["correction_rate_pct"] == 100.0 and summary["errors_after_correction"] == 0
    assert len(r.json()["results"]) == summary["tasks"]
    assert client.post("/api/evaluation/benchmark").status_code == 401


def test_stream_endpoint_emits_real_agent_events_then_result(client, auth):
    import json
    with client.stream("POST", "/api/tasks/stream", json={"prompt": "What is 2 + 3 * 4?"}, headers=auth) as r:
        assert r.status_code == 200
        lines = [json.loads(x) for x in r.iter_lines() if x]
    events = [(m["agent"], m["state"]) for m in lines if m["type"] == "event"]
    assert events[0] == ("planner", "start") and ("critic", "done") in events and ("fixer", "start") in events
    assert lines[-1]["type"] == "result" and lines[-1]["task"]["final_output"].endswith("14")
    assert client.get("/api/tasks", headers=auth).json()["total"] >= 1


def test_stream_requires_login(client):
    assert client.post("/api/tasks/stream", json={"prompt": "What is 2 + 3?"}).status_code == 401
