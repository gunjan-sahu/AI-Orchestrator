"""End-to-end demo against a running server.

    python run.py            (terminal 1)
    python demo.py           (terminal 2)   optional: python demo.py http://127.0.0.1:8000
"""
import sys
import uuid

import httpx

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000").rstrip("/")


def show(label: str, task: dict) -> None:
    print(f"\n=== {label} ===")
    print(f"verified={task['verified']}  iterations={task['iterations']}  "
          f"issues_found={task['issues_found']}  issues_fixed={task['issues_fixed']}  latency={task['latency_ms']}ms")
    for step in task["steps"]:
        print(f"  round {step['number']}: {step['verdict'].upper()}  {step['issues'] or ''}")
    print("  final answer:", task["final_output"].strip().splitlines()[-1])


def main() -> int:
    email = f"demo-{uuid.uuid4().hex[:8]}@example.com"
    try:
        with httpx.Client(base_url=f"{BASE}/api", timeout=180) as c:
            c.post("/auth/register", json={"email": email, "full_name": "Demo User", "password": "DemoPass123"}).raise_for_status()
            token = c.post("/auth/login", json={"email": email, "password": "DemoPass123"}).json()["access_token"]
            c.headers["Authorization"] = f"Bearer {token}"
            print(f"Logged in as {email}")

            prompt = "What is 2 + 3 * 4?"
            for mode, label in (("baseline", "One-step AI (baseline)"), ("self_correcting", "Self-correcting pipeline")):
                r = c.post("/tasks", json={"prompt": prompt, "mode": mode})
                r.raise_for_status()
                show(label, r.json())

            print("\n=== Benchmark ===")
            summary = c.post("/evaluation/benchmark").json()["summary"]
            print(summary)
    except httpx.ConnectError:
        print(f"Could not connect to {BASE}. Start the server first with:  python run.py")
        return 1
    except httpx.HTTPStatusError as exc:
        print("Request failed:", exc.response.status_code, exc.response.text)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
