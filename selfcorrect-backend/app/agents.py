"""The agents. Quick mode is one call; Verified mode is Planner -> Executor -> Critic -> Fixer.

Verified-mode agents do not pass free text to each other. Each one returns a structured artifact that the
next one is built to consume:

  Planner  -> approach, steps, assumptions, risks, CHECKS (acceptance criteria the Critic must test)
  Executor -> answer, CLAIMS it relies on, uncertainties, deviations from the plan
  Critic   -> evidence-backed objections (severity, type, target), rulings on earlier objections, what it verified
  Fixer    -> a response to EACH objection (accept / reject with reasoning / partial) + the corrected answer

With LLM_PROVIDER=mock (default) a small offline rule-based engine produces the same artifacts so the whole
project runs without an API key. Its Executor is deliberately a naive left-to-right solver.
"""
import json
import re

from app import llm, sandbox, verifiers
from app.config import settings

# ---------------------------------------------------------------- prompts
QUICK_SYSTEM = (
    "Answer directly and briefly. Put the answer in the first line. No preamble, no restating the question, "
    "no headings, no closing offers. Calculations: show at most 3 short lines of working. Code: one fenced block, "
    "minimal comments. Explanations: a few tight sentences, no padding. For a numeric result end with a line "
    "'Answer: <number>'. If you are unsure, say so in one sentence instead of guessing confidently.")

PLANNER_SYSTEM = (
    "You are the PLANNER in a four-agent review pipeline (Planner, Executor, Critic, Fixer). You do NOT answer the "
    "task. Others will act on your output: the Executor follows your steps, and the Critic tests the answer against "
    "your checks. Reply with JSON only: "
    '{"approach": "one-sentence strategy", "steps": ["3-6 specific imperative steps"], '
    '"assumptions": ["interpretations you are making where the task is ambiguous"], '
    '"risks": ["specific ways a solver is likely to go wrong on THIS task"], '
    '"checks": ["2-4 concrete, testable acceptance criteria"]}. '
    "Be specific to this task. Generic steps such as 'understand the task' are not allowed.")

EXECUTOR_SYSTEM = (
    "You are the EXECUTOR. Follow the Planner's steps and treat its listed risks as traps to avoid. Reply in exactly "
    "this format and nothing else:\n"
    "<answer>the full solution in markdown; code in fenced blocks; a numeric result ends with a line "
    "'Answer: <number>'</answer>\n"
    "<claims>the load-bearing facts, calculations or logic your answer depends on, one per line as 'C1: ...', "
    "'C2: ...' (max 6)</claims>\n"
    "<uncertain>what you assumed or are unsure about, one per line, or 'none'</uncertain>\n"
    "<deviations>where and why you departed from the plan, or 'none'</deviations>")

CRITIC_SYSTEM = (
    "You are the CRITIC. Your job is to find real defects, not to approve. Work from evidence: independently "
    "re-derive results (recompute numbers, trace the code, test each claim) before judging. You are given the "
    "plan's acceptance checks, the Executor's claims and uncertainties, and VERIFIER RESULTS, which are "
    "deterministic ground truth: never contradict them.\n"
    "Rules:\n"
    "1. Every objection MUST carry concrete evidence (your recomputation, a counterexample, the exact wrong claim "
    "or line). Without evidence it is not an objection: put it under 'risks'.\n"
    "2. severity: blocking = the answer is wrong or unsafe; major = materially incomplete or misleading; "
    "minor = small inaccuracy. Never report style, tone or length preferences.\n"
    "3. In a later round you are shown earlier objections with the Fixer's response. Rule on each: 'resolved', "
    "'upheld' (say what is still wrong), or 'withdrawn' (if the Fixer's rebuttal is correct). Also check that the "
    "fix did not introduce new errors (set introduced_by_fix true).\n"
    "4. List what you actually verified and how. Do not claim checks you did not perform.\n"
    "Reply with JSON only: "
    '{"verdict": "approve" or "revise", "verified": ["what you checked, and how"], '
    '"objections": [{"target": "C1 or answer or check:2", "severity": "blocking|major|minor", '
    '"type": "logic|fact|math|code|completeness|assumption", "problem": "...", "evidence": "...", '
    '"suggested_fix": "...", "introduced_by_fix": false}], '
    '"rulings": [{"id": "O1", "ruling": "resolved|upheld|withdrawn", "reason": "..."}], '
    '"risks": ["things you could not verify"]}. '
    'Use verdict "revise" only if a blocking or major objection stands.')

FIXER_SYSTEM = (
    "You are the FIXER. The Critic raised the objections listed below, each with an id. Respond to EACH id: "
    "'accept' (and fix it), 'reject' (the Critic is wrong: give evidence; you are allowed to disagree), or "
    "'partial'. Change ONLY what accepted objections require and keep everything else as it was. Objections from "
    "the deterministic verifier are ground truth and cannot be rejected. Reply in exactly this format and nothing "
    "else:\n"
    '<responses>JSON list: [{"id": "O1", "action": "accept|reject|partial", "reason": "...", '
    '"change": "what you changed, empty if rejected"}]</responses>\n'
    "<answer>the complete corrected answer, following the same format rules as the original (numeric results "
    "end with 'Answer: <number>')</answer>")

VALID_SEVERITY = {"blocking", "major", "minor"}
VALID_TYPE = {"logic", "fact", "math", "code", "completeness", "assumption"}
MAX_OBJECTIONS = 5


def is_mock() -> bool:
    return settings.llm_provider == "mock"


_mock = is_mock  # kept for older callers/tests


def quick_model() -> str:
    return getattr(settings, "llm_quick_model", "") or settings.llm_model


# ---------------------------------------------------------------- parsing helpers (LLM replies are never trusted)
def _json_obj(text: str, opener: str = "{", closer: str = "}"):
    start, end = text.find(opener), text.rfind(closer)
    if start == -1 or end <= start:
        return None
    try:
        return json.loads(text[start:end + 1])
    except ValueError:
        return None


def _tag(text: str, name: str) -> str | None:
    m = re.search(rf"<{name}>(.*?)(?:</{name}>|(?=<(?:answer|claims|uncertain|deviations|responses)>)|\Z)", text,
                  re.DOTALL | re.IGNORECASE)
    return m.group(1).strip() if m else None


def _bullets(block: str | None) -> list[str]:
    items = [re.sub(r"^\s*(?:[-*•]|\d+[.)])\s*", "", ln).strip() for ln in (block or "").splitlines()]
    return [i for i in items if i and i.lower() not in ("none", "n/a", "none.")]


def _strs(value, limit: int = 8) -> list[str]:
    return [str(v).strip() for v in value if str(v).strip()][:limit] if isinstance(value, list) else []


# ---------------------------------------------------------------- mock (offline) helpers
def _naive_eval(expr: str) -> float | None:
    """Left-to-right evaluation that ignores precedence - a typical first-draft mistake."""
    tokens = re.findall(r"\d+\.?\d*|\.\d+|\*\*|[-+*/%()]", expr)
    pos = 0

    def apply(op, a, b):
        if op == "+": return a + b
        if op == "-": return a - b
        if op == "*": return a * b
        if op == "/": return a / b
        if op == "%": return a % b
        if op == "**":
            if abs(b) > 100: raise ValueError
            return a ** b
        raise ValueError

    def atom():
        nonlocal pos
        tok = tokens[pos]
        pos += 1
        if tok == "(":
            value = chain()
            pos += 1  # skip ")"
            return value
        if tok == "-":
            return -atom()
        if tok == "+":
            return atom()
        return float(tok)

    def chain():
        nonlocal pos
        value = atom()
        while pos < len(tokens) and tokens[pos] != ")":
            op = tokens[pos]
            pos += 1
            value = apply(op, value, atom())
        return value

    try:
        result = chain()
        return result if isinstance(result, (int, float)) else None
    except (IndexError, ValueError, ZeroDivisionError, OverflowError):
        return None


# ---------------------------------------------------------------- Quick mode
def quick(task: str) -> str:
    """One lightweight call. No plan, no review, no second pass."""
    if is_mock():
        expr = verifiers.extract_expression(task)
        value = _naive_eval(expr) if expr else None
        if value is not None:
            return f"{expr} = {verifiers.fmt(value)}\n\nAnswer: {verifiers.fmt(value)}"
        return ("Offline mock engine: no AI model is configured, so Quick mode cannot answer this. "
                "Set LLM_PROVIDER=anthropic or openai in .env.")
    return llm.complete(QUICK_SYSTEM, task, max_tokens=700, temperature=0.2, model=quick_model())


# ---------------------------------------------------------------- Planner
def plan(task: str) -> dict:
    if is_mock():
        expr = verifiers.extract_expression(task)
        if expr:
            return {"approach": "Apply standard operator precedence to the expression.",
                    "steps": [f"Identify the arithmetic expression: {expr}", "Evaluate it step by step",
                              "Report the result as 'Answer: <number>'"],
                    "assumptions": [], "risks": ["Left-to-right evaluation ignores operator precedence."],
                    "checks": ["The stated result equals the expression evaluated with precedence."]}
        return {"approach": "Outline a structured response.",
                "steps": ["Understand what the task asks for", "Draft a structured response",
                          "Review the draft for completeness"],
                "assumptions": [], "risks": [], "checks": ["The response addresses the task."]}
    text = llm.complete(PLANNER_SYSTEM, task, max_tokens=600, temperature=0.3)
    data = _json_obj(text)
    if isinstance(data, dict) and _strs(data.get("steps")):
        return {"approach": str(data.get("approach", "")).strip(), "steps": _strs(data["steps"], 6),
                "assumptions": _strs(data.get("assumptions"), 4), "risks": _strs(data.get("risks"), 4),
                "checks": _strs(data.get("checks"), 4)}
    steps = [re.sub(r"^\s*(?:\d+[.)]|[-*•])\s*", "", ln).strip() for ln in text.splitlines() if ln.strip()]
    return {"approach": "", "steps": steps[:6] or ["Solve the task step by step."], "assumptions": [], "risks": [],
            "checks": []}


def _plan_block(p: dict) -> str:
    parts = [f"APPROACH: {p['approach']}" if p.get("approach") else "",
             "STEPS:\n" + "\n".join(f"{i}. {s}" for i, s in enumerate(p["steps"], 1))]
    for label, key in (("ASSUMPTIONS", "assumptions"), ("RISKS TO AVOID", "risks"), ("ACCEPTANCE CHECKS", "checks")):
        if p.get(key):
            parts.append(f"{label}:\n" + "\n".join(f"- {x}" for x in p[key]))
    return "\n".join(x for x in parts if x)


# ---------------------------------------------------------------- Executor
def execute(task: str, p: dict) -> dict:
    if is_mock():
        expr = verifiers.extract_expression(task)
        value = _naive_eval(expr) if expr else None
        if value is not None:
            return {"answer": f"Working left to right:\n{expr} = {verifiers.fmt(value)}\n\nAnswer: {verifiers.fmt(value)}",
                    "claims": [f"C1: {expr} = {verifiers.fmt(value)}"], "uncertain": [], "deviations": []}
        outline = "\n".join(f"- {s}" for s in p["steps"])
        return {"answer": (f"Task: {task}\n\nPlan followed:\n{outline}\n\n"
                           "Note: mock mode is active (no AI model configured), so this is a structured outline only. "
                           "Set LLM_PROVIDER=anthropic or openai in .env to get real generated answers."),
                "claims": [], "uncertain": ["Offline mock engine produced an outline, not a real answer."], "deviations": []}
    text = llm.complete(EXECUTOR_SYSTEM, f"TASK:\n{task}\n\nPLAN:\n{_plan_block(p)}", max_tokens=2048, temperature=0.3)
    answer = _tag(text, "answer")
    if not answer:  # the model ignored the format: keep its text as the answer rather than failing
        return {"answer": text.strip(), "claims": [], "uncertain": [], "deviations": []}
    return {"answer": answer, "claims": _bullets(_tag(text, "claims"))[:6], "uncertain": _bullets(_tag(text, "uncertain")),
            "deviations": _bullets(_tag(text, "deviations"))}


# ---------------------------------------------------------------- Critic
def _normalize_critic(data: dict) -> dict:
    """Policy applied to the Critic's raw JSON: no evidence -> not an objection; cap the count; fix bad enums."""
    objections, risks = [], _strs(data.get("risks"), 5)
    for o in data.get("objections", []) if isinstance(data.get("objections"), list) else []:
        if not isinstance(o, dict):
            continue
        problem, evidence = str(o.get("problem", "")).strip(), str(o.get("evidence", "")).strip()
        if not problem:
            continue
        if len(evidence) < 12:  # unsubstantiated: surfaced as a risk, can never trigger a correction cycle
            risks.append(f"(unsubstantiated) {problem}")
            continue
        severity = str(o.get("severity", "")).lower()
        kind = str(o.get("type", "")).lower()
        objections.append({"target": str(o.get("target", "answer")), "problem": problem, "evidence": evidence,
                           "severity": severity if severity in VALID_SEVERITY else "minor",
                           "type": kind if kind in VALID_TYPE else "logic",
                           "suggested_fix": str(o.get("suggested_fix", "")).strip(),
                           "introduced_by_fix": bool(o.get("introduced_by_fix"))})
    rank = {"blocking": 0, "major": 1, "minor": 2}
    objections.sort(key=lambda o: rank[o["severity"]])
    rulings = [r for r in data.get("rulings", []) if isinstance(r, dict)] if isinstance(data.get("rulings"), list) else []
    return {"verdict": "approve" if str(data.get("verdict", "")).lower() == "approve" else "revise",
            "verified": _strs(data.get("verified"), 6), "objections": objections[:MAX_OBJECTIONS],
            "rulings": rulings, "risks": risks[:6], "parsed": True,
            "check_code": str(data.get("check_code") or "").strip()[:3000]}


def _critic_prompt(task, p, draft, output, findings, prior, rnd) -> str:
    claims = "\n".join(draft["claims"]) or "(none stated)"
    uncertain = "\n".join(f"- {u}" for u in draft["uncertain"]) or "none"
    ground = "\n".join(f"- {f['problem']} Evidence: {f['evidence']}" for f in findings) or "all deterministic checks pass"
    parts = [f"TASK:\n{task}", f"PLAN CHECKS:\n" + ("\n".join(f"{i}. {c}" for i, c in enumerate(p.get("checks", []), 1)) or "(none)"),
             f"EXECUTOR CLAIMS:\n{claims}", f"EXECUTOR UNCERTAINTIES:\n{uncertain}",
             f"VERIFIER RESULTS (ground truth):\n{ground}", f"ANSWER (round {rnd}):\n{output}"]
    if prior:
        parts.insert(1, "EARLIER OBJECTIONS AND THE FIXER'S RESPONSES (rule on each by id):\n" + json.dumps(prior, indent=1))
    if sandbox.enabled():
        parts.append(
            "EXECUTION TOOL (use it whenever the answer can be tested by code): add a field \"check_code\" to your JSON "
            "with a short stdlib-only Python 3 script (max 25 lines) that independently tests the answer. The string "
            "variable ANSWER holds the answer text (extract code blocks from it with re if needed, then exec them). "
            "Print 'PASS' if the answer is correct, otherwise print 'FAIL: <what is wrong and the correct value>'. "
            "Good uses: counting letters/words/sentences, exact arithmetic, date maths, running the answer's code with "
            "your own test inputs. Omit it if the answer cannot be tested by code. Your script is executed for real "
            "and its output is shown as evidence.")
    return "\n\n".join(parts)


def _apply_executed_check(review: dict, output: str) -> dict:
    """Run the Critic's check_code in the sandbox; real output becomes evidence, never the model's opinion."""
    code = review.pop("check_code", "")
    if not code or not sandbox.enabled():
        return review
    res = sandbox.run_python(code, answer=output, timeout=5)
    text = res["output"]
    first = text.splitlines()[0] if text else ""
    if res["ok"] and first.upper().startswith("FAIL"):
        review["objections"].insert(0, {"target": "answer", "severity": "blocking", "type": "logic",
                                        "problem": first[:300], "executed": True, "suggested_fix": text[:300],
                                        "evidence": f"Executed the Critic's independent check against this answer; it printed: {text}"})
        review["verdict"] = "revise"
    elif res["ok"] and first.upper().startswith("PASS"):
        review["verified"].append("Executed an independent check script against the answer: PASS.")
    else:  # the check itself crashed or timed out: say so, do not turn it into an accusation
        review["risks"].append(f"The Critic's executable check could not be used ({text[:160] or 'no output'}).")
    return review


def critique(task: str, p: dict, draft: dict, output: str, findings: list[dict], prior: list[dict] | None,
             rnd: int) -> dict:
    """Review the current answer. Deterministic findings are handled by the caller; this returns the LLM's review."""
    if is_mock():
        expr = verifiers.extract_expression(task)
        verified = ([f"Recomputed '{expr}' with a safe evaluator (operator precedence applied)."] if expr
                    else ["Answer is non-empty."])
        return {"verdict": "revise" if findings else "approve", "verified": verified, "objections": [],
                "rulings": [], "risks": [], "parsed": True, "check_code": ""}
    text = llm.complete(CRITIC_SYSTEM, _critic_prompt(task, p, draft, output, findings, prior, rnd),
                        max_tokens=900, temperature=0.0)
    data = _json_obj(text)
    if not isinstance(data, dict):  # unreadable reply: say so instead of silently approving or failing
        return {"verdict": "approve" if not findings else "revise", "verified": [], "objections": [], "rulings": [],
                "risks": ["The Critic's reply was unreadable, so only deterministic checks were applied this round."],
                "parsed": False, "check_code": ""}
    return _apply_executed_check(_normalize_critic(data), output)


# ---------------------------------------------------------------- Fixer
def fix(task: str, p: dict, output: str, objections: list[dict]) -> dict:
    """Respond to every objection and return a corrected answer."""
    if is_mock():
        expr = verifiers.extract_expression(task)
        expected = verifiers.expected_answer(task)
        responses = [{"id": o["id"], "action": "accept", "reason": "Verifier is ground truth.",
                      "change": "Applied operator precedence."} for o in objections]
        if expr and expected is not None:
            answer = ("Correction: operator precedence applied (brackets, powers, then multiply/divide, then add/subtract).\n"
                      f"{expr} = {verifiers.fmt(expected)}\n\nAnswer: {verifiers.fmt(expected)}")
            return {"responses": responses, "answer": answer}
        return {"responses": [{**r, "action": "reject", "reason": "The offline engine cannot repair this.", "change": ""}
                              for r in responses], "answer": output}
    brief = [{"id": o["id"], "severity": o["severity"], "type": o["type"], "source": o["source"],
              "problem": o["problem"], "evidence": o["evidence"], "suggested_fix": o["suggested_fix"],
              **({"your_earlier_rebuttal": o["fixer_reason"]} if o.get("fixer_action") == "reject" else {})}
             for o in objections]
    prompt = (f"TASK:\n{task}\n\nACCEPTANCE CHECKS:\n" + "\n".join(f"- {c}" for c in p.get("checks", [])) +
              f"\n\nCURRENT ANSWER:\n{output}\n\nOBJECTIONS:\n{json.dumps(brief, indent=1)}")
    text = llm.complete(FIXER_SYSTEM, prompt, max_tokens=2048, temperature=0.2)
    answer = _tag(text, "answer") or ("" if _tag(text, "responses") is not None else text.strip())
    raw = _json_obj(_tag(text, "responses") or "", "[", "]")
    by_id = {str(r.get("id")): r for r in raw if isinstance(r, dict)} if isinstance(raw, list) else {}
    responses = []
    for o in objections:
        r = by_id.get(o["id"])
        if r and str(r.get("action", "")).lower() in ("accept", "reject", "partial"):
            responses.append({"id": o["id"], "action": str(r["action"]).lower(), "reason": str(r.get("reason", "")).strip(),
                              "change": str(r.get("change", "")).strip()})
        else:  # the Fixer skipped this objection: record that honestly instead of pretending it was handled
            responses.append({"id": o["id"], "action": "accept", "reason": "(no explicit response given)",
                              "change": "", "implicit": True})
    return {"responses": responses, "answer": answer or output}
