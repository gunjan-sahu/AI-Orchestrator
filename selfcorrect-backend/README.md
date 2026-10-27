# Self-Correcting Multi-Agent AI Pipeline — Backend

Mini Project, V Semester — Project Head: **Dr. Rohit Rastogi**
Students: **Filorance (2400320100453)**, **Gunjan Sahu (2400320100478)**

A REST API backend that does not trust the first AI answer. Every task passes through four agents:

```
USER TASK ─► PLANNER ─► EXECUTOR ─► CRITIC ─► (errors found?) ─► FIXER ─┐
                                      ▲                                  │
                                      └────────── re-check ◄─────────────┘
                                      │ (no errors)
                                      ▼
                               VALIDATED OUTPUT
```

| Agent | Job |
|-------|-----|
| **Planner** | Breaks the task into steps |
| **Executor** | Writes the first solution |
| **Critic** | Finds logical, math and code errors and explains them |
| **Fixer** | Applies the Critic's feedback; the result is re-checked (up to `MAX_ITERATIONS` rounds) |

A **baseline mode** (one-step AI, no Critic/Fixer) is included so the two approaches can be compared exactly as described in the project's evaluation plan (accuracy, error reduction, correction rate, latency).

---

## Tech stack

| Part | Choice | Why |
|------|--------|-----|
| Language | Python 3.10+ | Easy to read, best AI ecosystem |
| Web framework | **FastAPI** | Automatic input validation and a built-in interactive docs page (`/docs`) |
| Database | **SQLite** via **SQLAlchemy 2** | Zero setup — a single file, created automatically. Switching to PostgreSQL only needs a different `DATABASE_URL` |
| Auth | **JWT** (PyJWT) + PBKDF2-SHA256 password hashing | Standard, stateless, no extra native dependencies |
| AI models | Anthropic (Claude), any OpenAI-compatible API (OpenAI, Groq, Ollama…) or an **offline mock engine** | Works with or without an API key |
| Tests | pytest | 38 automated tests |

## Project structure

```
selfcorrect-backend/
├── app/
│   ├── main.py            # App setup, CORS, global error handlers, health check
│   ├── config.py          # Reads and validates .env settings
│   ├── database.py        # SQLAlchemy engine + session
│   ├── models.py          # Tables: User, Task, IterationLog
│   ├── schemas.py         # Request/response models + validation rules
│   ├── security.py        # Password hashing, JWT, failed-login limiter
│   ├── deps.py            # "Current logged-in user" dependency
│   ├── errors.py          # One consistent JSON error format
│   ├── llm.py             # Calls Anthropic / OpenAI-compatible APIs
│   ├── agents.py          # Planner, Executor, Critic, Fixer
│   ├── verifiers.py       # Deterministic checks (safe math evaluator, Python syntax)
│   ├── pipeline.py        # Orchestrator: runs the correction loop
│   └── routers/           # auth.py · tasks.py · evaluation.py
├── frontend/              # Web interface (plain HTML/CSS/JS), served at /app
│   ├── index.html login.html register.html history.html evaluation.html profile.html about.html 404.html
│   ├── css/style.css      # Design system + animations
│   └── js/                # api.js (backend client) · app.js · ui.js · per-page scripts
├── tests/                 # pytest suite
├── run.py                 # Starts the server
├── demo.py                # Command-line demo of the whole flow
├── check_project.py       # File check (all files present, code compiles, app imports)
├── requirements.txt
├── .env.example
└── README.md
```

---

## Installation and run (5 steps)

You need **Python 3.10 or newer** (`python --version`). On macOS/Linux use `python3` if `python` is not found.

**1. Open a terminal in the project folder**
```bash
cd selfcorrect-backend
```

**2. Create and activate a virtual environment**
```bash
python -m venv .venv
# Windows (PowerShell):  .venv\Scripts\Activate.ps1
# Windows (cmd):         .venv\Scripts\activate.bat
# macOS / Linux:         source .venv/bin/activate
```

**3. Install the dependencies**
```bash
pip install -r requirements.txt
```

**4. Create your settings file**
```bash
# macOS / Linux
cp .env.example .env
# Windows
copy .env.example .env
```
Then generate a secret key and paste it as `SECRET_KEY` in `.env`:
```bash
python -c "import secrets; print(secrets.token_hex(32))"
```
(The app also starts without this — it then uses a temporary key and you must log in again after each restart.)

**5. Start the server**
```bash
python run.py
```
Open **http://127.0.0.1:8000** — the web app (register, run tasks, history, evaluation). The interactive API docs are at **http://127.0.0.1:8000/docs**. The database file (`data/selfcorrect.db`) is created automatically.

> The default `LLM_PROVIDER=mock` needs **no API key** — see "AI providers" below for real models.

### Quick check that everything works
```bash
python check_project.py     # file check
python -m pytest -q         # 38 tests
python demo.py              # with the server running in another terminal
```

---

## The web interface

Served by the same server — no separate frontend setup, no CORS issues:

| Page | URL | What it does |
|------|-----|--------------|
| Sign in / Register | `/app/login.html`, `/app/register.html` | Account creation with inline validation |
| Orchestrator | `/app/index.html` | Run a prompt in *Self-correcting* or *Baseline* mode, see the four agents, every Critic round and the final answer |
| History | `/app/history.html` | Filter, page through, open and delete past tasks |
| Evaluation | `/app/evaluation.html` | Your baseline vs self-correcting stats and the built-in benchmark |
| Profile | `/app/profile.html` | Account, results snapshot, recent tasks, sign out |
| How it works | `/app/about.html` | Animated explanation of the pipeline (public) |

The UI talks to `/api` on the same origin. If you open the HTML files from a different static server instead, they fall back to `http://127.0.0.1:8000/api`.

## Try it in the browser (Swagger UI)

1. Go to `/docs` → **POST /api/auth/register** → *Try it out* → Execute.
2. **POST /api/auth/login** → copy the `access_token` from the response.
3. Click the green **Authorize** button at the top, paste the token, and confirm.
4. **POST /api/tasks** with `{"prompt": "What is 2 + 3 * 4?"}` and read the response: `initial_output` is wrong (20), the Critic flags it, and `final_output` is correct (14).
5. Run the same prompt with `"mode": "baseline"` to see the uncorrected result, then try **POST /api/evaluation/benchmark**.

## Try it with curl

```bash
# register + login
curl -X POST http://127.0.0.1:8000/api/auth/register -H "Content-Type: application/json" \
  -d '{"email":"me@example.com","full_name":"My Name","password":"Passw0rd123"}'
TOKEN=$(curl -s -X POST http://127.0.0.1:8000/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"me@example.com","password":"Passw0rd123"}' | python -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

# run a task through the self-correcting pipeline
curl -X POST http://127.0.0.1:8000/api/tasks -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"prompt":"What is 2 + 3 * 4?"}'
```

---

## API reference

All routes are under `/api`. 🔒 = needs header `Authorization: Bearer <token>`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Server and database status |
| POST | `/api/auth/register` | Create account (`email`, `full_name`, `password` ≥ 8 chars with a letter and a number) |
| POST | `/api/auth/login` | Returns a JWT access token |
| GET | `/api/auth/me` 🔒 | Current user |
| POST | `/api/tasks` 🔒 | Run a task. Body: `prompt` (5–4000 chars), `mode` (`self_correcting` default or `baseline`), `max_iterations` (1–5, optional) |
| GET | `/api/tasks` 🔒 | Your history, newest first. Query: `limit`, `offset`, `mode` |
| GET | `/api/tasks/{id}` 🔒 | One task with the plan and every Critic round |
| DELETE | `/api/tasks/{id}` 🔒 | Delete a task |
| GET | `/api/evaluation/stats` 🔒 | Your baseline vs self-correcting numbers |
| POST | `/api/evaluation/benchmark` 🔒 | Runs 6 built-in arithmetic tasks in both modes and compares accuracy, correction rate and latency overhead |

**Task response (important fields):** `plan`, `initial_output` (first Executor answer), `final_output`, `verified` (passed the Critic), `iterations`, `issues_found`, `issues_fixed`, `latency_ms`, `steps[]` (each round's output, verdict and issues).

**Errors** always use the same shape:
```json
{"error": {"code": "validation_error", "message": "Request validation failed.", "details": [{"field": "password", "message": "..."}]}}
```
Codes used: `validation_error` (422), `not_authenticated` / `invalid_token` / `token_expired` / `invalid_credentials` (401), `task_not_found` / `not_found` (404), `email_taken` (409), `too_many_attempts` (429), `llm_error` (502), `server_error` (500).

---

## How the correction loop works

1. **Planner** writes numbered steps. **Executor** produces the first answer (saved as `initial_output`).
2. **Critic** reviews the answer. It always runs the deterministic checks in `verifiers.py`:
   * arithmetic in the task is evaluated with a **safe AST evaluator** (never `eval`) and compared with the answer's final `Answer: <number>` line,
   * fenced Python code blocks must parse,
   * the answer must not be empty.

   With a real model, the LLM Critic additionally reviews logic and facts and returns JSON `{"verdict", "issues"}`.
3. If issues exist, the **Fixer** rewrites the answer and the Critic checks again, up to `MAX_ITERATIONS`. The loop stops early if the Fixer changes nothing.
4. `verified=true` means the final answer passed the Critic; otherwise the best attempt is returned with `verified=false` and the remaining issues are in `steps`.

**Baseline mode** runs only the Executor (no plan, Critic or Fixer). An independent deterministic check *measures* the result so the two modes can be compared fairly.

## AI providers

Set these in `.env`:

| `LLM_PROVIDER` | What it does | Extra settings |
|----------------|--------------|----------------|
| `mock` (default) | Offline rule-based engine. Its Executor is intentionally a *naive first-draft solver* that ignores operator precedence, so the Critic and Fixer visibly catch and repair real errors in arithmetic tasks. Non-math tasks only get a structured outline. | none |
| `anthropic` | Claude via the Anthropic API | `LLM_API_KEY=...` (model default `claude-sonnet-5-5`, change with `LLM_MODEL`) |
| `openai` | Any OpenAI-compatible API | `LLM_API_KEY`, `LLM_MODEL`, and `LLM_BASE_URL` (e.g. Groq, or local Ollama at `http://localhost:11434/v1`) |

For real answers to open-ended tasks (code, explanations, reasoning) use `anthropic` or `openai`. Restart the server after editing `.env`. If the model service fails, the API returns `502 llm_error` instead of crashing.

## Environment variables

| Variable | Default | Meaning |
|----------|---------|---------|
| `SECRET_KEY` | temporary random | JWT signing key, ≥ 32 chars |
| `TOKEN_EXPIRE_MINUTES` | 60 | Login token lifetime |
| `LOGIN_MAX_ATTEMPTS` | 10 | Failed logins per IP per 5 minutes before a 429 |
| `DATABASE_URL` | `sqlite:///./data/selfcorrect.db` | SQLAlchemy database URL |
| `LLM_PROVIDER` / `LLM_API_KEY` / `LLM_MODEL` / `LLM_BASE_URL` | mock / – / auto / auto | See above |
| `LLM_TIMEOUT_SECONDS` | 60 | Timeout per model call |
| `MAX_ITERATIONS` | 3 | Default Critic rounds |
| `HOST` / `PORT` | 127.0.0.1 / 8000 | Server address |
| `CORS_ORIGINS` | `*` | Allowed browser origins (comma-separated) |

## Security features

* Passwords are salted and hashed with PBKDF2-SHA256 (200,000 iterations); never stored or returned in plain text.
* JWT tokens expire; invalid/expired tokens give clear 401 errors.
* Failed-login limiter against brute force; identical error for unknown email and wrong password.
* Users can only see and delete **their own** tasks (others get 404).
* All input is validated (types, lengths, email format, password strength, allowed modes).
* Math is evaluated by a restricted AST evaluator — no `eval`, exponent and length limits.
* SQL injection is prevented by the SQLAlchemy ORM; error responses never leak stack traces.

**For real deployment:** set a permanent `SECRET_KEY`, restrict `CORS_ORIGINS`, and run behind HTTPS.

## Evaluation (maps to the project's evaluation plan)

| Metric in the plan | Where to get it |
|--------------------|-----------------|
| Accuracy | `accuracy_pct` in `POST /api/evaluation/benchmark` |
| Error reduction | `errors_before_correction` vs `errors_after_correction` |
| Correction rate | `correction_rate_pct` (benchmark) or per-user in `GET /api/evaluation/stats` |
| Latency | `latency_overhead_ms` (benchmark), `latency_ms` on every task |

With the offline mock engine, the benchmark's baseline is intentionally weak (naive solver), so use a real model (`anthropic`/`openai`) for meaningful research numbers.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `python` not found | Use `python3`, or install Python 3.10+ |
| `ModuleNotFoundError` | Activate the virtual environment, then `pip install -r requirements.txt` |
| `ConfigError: LLM_PROVIDER=anthropic requires LLM_API_KEY` | Add your key to `.env`, or set `LLM_PROVIDER=mock` |
| Port already in use | Change `PORT` in `.env` |
| `401` after restarting | `SECRET_KEY` is not set permanently — set it in `.env` and log in again |
| Want a clean database | Stop the server and delete the `data/` folder |

## Future scope (from the project slides)

Adaptive routing between agents/tools by task type · memory of past corrections · multimodal input · stronger benchmarks and domain-specific critics. The agent functions in `agents.py` and the checks in `verifiers.py` are the natural extension points.
