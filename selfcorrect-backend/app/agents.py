"""The four agents: Planner -> Executor -> Critic -> Fixer.

With LLM_PROVIDER=anthropic/openai each agent is a prompt to a language model.
With LLM_PROVIDER=mock (default) a small offline rule-based engine is used instead, so the whole
project runs without an API key. Its Executor is deliberately a "naive first draft" solver that
ignores operator precedence, which lets the Critic and Fixer demonstrate real self-correction.
"""
import json
import re

from app import llm, verifiers
from app.config import settings

PLANNER_SYSTEM = ("You are the PLANNER agent. Break the user's task into 3-6 short numbered steps. "
                  "Output only the numbered list.")
EXECUTOR_SYSTEM = ("You are the EXECUTOR agent. Solve the task, following the plan if one is given. Be accurate and "
                   "concise. If the result is a number, finish with a last line exactly like 'Answer: <number>'. "
                   "Put any code in fenced code blocks.")
CRITIC_SYSTEM = ("You are the CRITIC agent. Check the answer for logical, factual, math and code errors. Reply with "
                 'JSON only: {"verdict": "pass" or "fail", "issues": ["short description", ...]}. '
                 "Use an empty issues list if the answer is correct.")
FIXER_SYSTEM = ("You are the FIXER agent. Rewrite the answer so every listed issue is corrected. Keep what is already "
                "correct. Return only the corrected answer (keep the final 'Answer: <number>' line for numeric results).")


def _mock() -> bool:
    return settings.llm_provider == "mock"


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


# ---------------------------------------------------------------- the four agents
def plan(task: str) -> list[str]:
    if _mock():
        expr = verifiers.extract_expression(task)
        if expr:
            return [f"Identify the arithmetic expression: {expr}",
                    "Evaluate it step by step",
                    "Report the result as 'Answer: <number>'"]
        return ["Understand what the task asks for", "Draft a structured response", "Review the draft for completeness"]
    text = llm.complete(PLANNER_SYSTEM, task)
    steps = [re.sub(r"^\s*(?:\d+[.)]|[-*•])\s*", "", line).strip() for line in text.splitlines() if line.strip()]
    return steps[:8] or ["Solve the task step by step."]


def execute(task: str, steps: list[str]) -> str:
    if _mock():
        expr = verifiers.extract_expression(task)
        value = _naive_eval(expr) if expr else None
        if value is not None:
            return f"Working left to right:\n{expr} = {verifiers.fmt(value)}\n\nAnswer: {verifiers.fmt(value)}"
        outline = "\n".join(f"- {s}" for s in steps) or "- (no plan - single-step mode)"
        return (f"Task: {task}\n\nPlan followed:\n{outline}\n\n"
                "Note: mock mode is active (no AI model configured), so this is a structured outline only. "
                "Set LLM_PROVIDER=anthropic or openai in .env to get real generated answers.")
    plan_text = "\n".join(f"{i}. {s}" for i, s in enumerate(steps, 1))
    prompt = f"TASK:\n{task}\n\nPLAN:\n{plan_text}" if steps else f"TASK:\n{task}"
    return llm.complete(EXECUTOR_SYSTEM, prompt)


def _parse_critic(text: str) -> list[str] | None:
    """Return the issue list from the Critic's JSON reply, or None if it cannot be parsed."""
    start, end = text.find("{"), text.rfind("}")
    try:
        data = json.loads(text[start:end + 1])
    except ValueError:
        return None
    issues = [str(i).strip() for i in data.get("issues", []) if str(i).strip()] if isinstance(data, dict) else []
    if isinstance(data, dict) and str(data.get("verdict", "")).lower() == "fail" and not issues:
        issues = ["The critic judged the answer to be incorrect."]
    return issues


def critique(task: str, output: str) -> list[str]:
    """Return a list of issues; an empty list means the answer passed review."""
    issues = verifiers.run_verifiers(task, output)  # deterministic checks always run
    if not _mock():
        reply = llm.complete(CRITIC_SYSTEM, f"TASK:\n{task}\n\nANSWER:\n{output}")
        llm_issues = _parse_critic(reply)
        for item in llm_issues or []:
            if item not in issues:
                issues.append(item)
    return issues


def fix(task: str, output: str, issues: list[str]) -> str:
    if _mock():
        expr = verifiers.extract_expression(task)
        expected = verifiers.expected_answer(task)
        if expr and expected is not None:
            return ("Correction: operator precedence applied (brackets, powers, then multiply/divide, then add/subtract).\n"
                    f"{expr} = {verifiers.fmt(expected)}\n\nAnswer: {verifiers.fmt(expected)}")
        return output  # the offline engine cannot repair other kinds of issues
    problems = "\n".join(f"- {i}" for i in issues)
    return llm.complete(FIXER_SYSTEM, f"TASK:\n{task}\n\nCURRENT ANSWER:\n{output}\n\nISSUES TO FIX:\n{problems}")
