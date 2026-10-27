"""Deterministic checks used by the Critic (the pipeline's "tools" layer).

They never call an AI model, so they give reliable, repeatable verdicts for:
  * arithmetic   - the task's expression is evaluated safely and compared with the stated answer
  * python code  - fenced ```python blocks must be syntactically valid
  * basic checks - the answer must not be empty
"""
import ast
import math
import operator
import re

_BIN_OPS = {
    ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
    ast.Div: operator.truediv, ast.FloorDiv: operator.floordiv, ast.Mod: operator.mod, ast.Pow: operator.pow,
}
_MAX_EXPR_LEN = 200
_MAX_EXPONENT = 100


def normalize(expr: str) -> str:
    return expr.replace("×", "*").replace("÷", "/").replace("^", "**").strip()


def safe_eval(expr: str) -> float:
    """Evaluate arithmetic WITHOUT using eval(): only numbers and + - * / // % ** are allowed."""
    expr = normalize(expr)
    if not expr or len(expr) > _MAX_EXPR_LEN:
        raise ValueError("Expression is empty or too long")
    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError:
        raise ValueError("Not a valid arithmetic expression") from None

    def ev(node):
        if isinstance(node, ast.Expression):
            return ev(node.body)
        if isinstance(node, ast.Constant) and type(node.value) in (int, float):
            return node.value
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
            return -ev(node.operand) if isinstance(node.op, ast.USub) else ev(node.operand)
        if isinstance(node, ast.BinOp) and type(node.op) in _BIN_OPS:
            left, right = ev(node.left), ev(node.right)
            if isinstance(node.op, ast.Pow) and abs(right) > _MAX_EXPONENT:
                raise ValueError("Exponent too large")
            try:
                return _BIN_OPS[type(node.op)](left, right)
            except ZeroDivisionError:
                raise ValueError("Division by zero") from None
            except OverflowError:
                raise ValueError("Number too large") from None
        raise ValueError("Unsupported expression")

    result = ev(tree)
    if isinstance(result, complex) or (isinstance(result, float) and not math.isfinite(result)):
        raise ValueError("Result is not a real number")
    return result


_CANDIDATE_RE = re.compile(r"[\d.(][\d\s.+\-*/%^()×÷]*[\d)]")


def extract_expression(text: str) -> str | None:
    """Find the longest valid arithmetic expression inside a sentence, e.g. 'What is 2 + 3 * 4?'."""
    best = None
    for cand in _CANDIDATE_RE.findall(text):
        cand = cand.strip()
        has_operator = re.search(r"[+*/%^×÷]", cand) or re.search(r"\s-\s", cand)
        if not has_operator:
            continue  # skips plain numbers and dates such as 2024-01-05
        try:
            safe_eval(cand)
        except ValueError:
            continue
        if best is None or len(cand) > len(best):
            best = cand
    return normalize(best) if best else None


def expected_answer(task: str) -> float | None:
    expr = extract_expression(task)
    if expr is None:
        return None
    try:
        return safe_eval(expr)
    except ValueError:
        return None


def fmt(value: float) -> str:
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return str(round(value, 6)) if isinstance(value, float) else str(value)


_ANSWER_RE = re.compile(r"answer\s*[:=]\s*(-?[\d,]*\.?\d+(?:e[+-]?\d+)?)", re.IGNORECASE)


def extract_answer(output: str) -> float | None:
    matches = _ANSWER_RE.findall(output or "")
    return float(matches[-1].replace(",", "")) if matches else None


def numbers_match(a: float, b: float) -> bool:
    return math.isclose(a, b, rel_tol=1e-6, abs_tol=1e-6)


def is_correct(task: str, output: str) -> bool:
    """Ground-truth check used by the benchmark (only meaningful for arithmetic tasks)."""
    expected, actual = expected_answer(task), extract_answer(output)
    return expected is not None and actual is not None and numbers_match(expected, actual)


def check_math(task: str, output: str) -> list[str]:
    expr = extract_expression(task)
    if expr is None:
        return []
    expected = expected_answer(task)
    actual = extract_answer(output)
    if actual is None:
        return ["The answer must end with a final line in the form 'Answer: <number>'."]
    if not numbers_match(expected, actual):
        return [f"Arithmetic error: '{expr}' equals {fmt(expected)} (operator precedence applied), "
                f"but the answer states {fmt(actual)}."]
    return []


def check_python(output: str) -> list[str]:
    issues = []
    blocks = re.findall(r"```(?:python|py)\s*\n(.*?)```", output or "", re.DOTALL | re.IGNORECASE)
    for i, code in enumerate(blocks, start=1):
        try:
            ast.parse(code)
        except SyntaxError as exc:
            issues.append(f"Python syntax error in code block {i}: {exc.msg} (line {exc.lineno}).")
    return issues


def check_basic(output: str) -> list[str]:
    if not output or len(output.strip()) < 10:
        return ["The answer is empty or too short."]
    return []


def run_verifiers(task: str, output: str) -> list[str]:
    return check_basic(output) + check_math(task, output) + check_python(output)
