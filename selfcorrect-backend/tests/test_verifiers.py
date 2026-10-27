import pytest

from app import verifiers as v


def test_safe_eval_respects_precedence():
    assert v.safe_eval("2 + 3 * 4") == 14
    assert v.safe_eval("(8 + 2) * 5 - 3") == 47
    assert v.safe_eval("2 ^ 3") == 8


@pytest.mark.parametrize("bad", ["__import__('os')", "1/0", "2 ** 9999", "abc", "", "1 +"])
def test_safe_eval_rejects_unsafe_or_invalid(bad):
    with pytest.raises(ValueError):
        v.safe_eval(bad)


def test_extract_expression():
    assert v.extract_expression("What is 2 + 3 * 4?") == "2 + 3 * 4"
    assert v.extract_expression("Compute 3 ^ 2") == "3 ** 2"
    assert v.extract_expression("The meeting is on 2024-01-05") is None
    assert v.extract_expression("Write a poem about the sea") is None


def test_check_math_detects_wrong_and_missing_answers():
    assert v.check_math("2 + 3 * 4", "Answer: 14") == []
    assert "Arithmetic error" in v.check_math("2 + 3 * 4", "Answer: 20")[0]
    assert "Answer:" in v.check_math("2 + 3 * 4", "It is fourteen")[0]


def test_check_python_syntax():
    assert v.check_python("```python\nprint('hi')\n```") == []
    assert "syntax error" in v.check_python("```python\ndef f(:\n  pass\n```")[0]


def test_check_basic():
    assert v.check_basic("") and v.check_basic("short")
    assert v.check_basic("This is long enough.") == []
