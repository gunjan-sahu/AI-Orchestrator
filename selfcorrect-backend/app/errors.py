"""One error type for the whole API, so every error response has the same JSON shape."""


class AppError(Exception):
    """Raise this anywhere to return a clean JSON error: {"error": {"code", "message"}}."""

    def __init__(self, status_code: int, code: str, message: str, headers: dict | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.headers = headers


def error_body(code: str, message: str, details: list | None = None) -> dict:
    body = {"error": {"code": code, "message": message}}
    if details:
        body["error"]["details"] = details
    return body
