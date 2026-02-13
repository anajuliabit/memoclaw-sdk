"""Exception hierarchy for the MemoClaw SDK."""

from __future__ import annotations

from typing import Any


class MemoClawError(Exception):
    """Base exception for all MemoClaw SDK errors."""


# ── Suggestions for common errors ────────────────────────────────────────────

_ERROR_SUGGESTIONS: dict[tuple[int, str], str] = {
    (401, "AUTH_ERROR"): "Check that your private key is correct and the signature hasn't expired. Ensure system clock is synced.",
    (402, "PAYMENT_REQUIRED"): "Free tier exhausted. Install x402 (`pip install memoclaw[x402]`) for automatic payment, or upgrade your plan.",
    (404, "NOT_FOUND"): "The memory ID may have been deleted or never existed. Use client.list() to verify.",
    (422, "VALIDATION_ERROR"): "Check request payload — content max length is 8192 chars, importance must be 0.0-1.0.",
    (429, "RATE_LIMITED"): "Too many requests. The SDK retries automatically, but consider adding delays between batch operations.",
    (500, "INTERNAL_ERROR"): "Server error — this is usually transient. The SDK will retry automatically.",
}


class APIError(MemoClawError):
    """Raised when the API returns a non-2xx response.

    Attributes:
        status_code: HTTP status code.
        code: Error code from the API (e.g. ``"NOT_FOUND"``).
        message: Human-readable error message.
        details: Optional structured error details.
        suggestion: Actionable suggestion for fixing the error.
    """

    status_code: int
    code: str
    message: str
    details: dict[str, Any] | None
    suggestion: str | None

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details
        self.suggestion = _ERROR_SUGGESTIONS.get((status_code, code))
        msg = f"[{status_code}] {code}: {message}"
        if self.suggestion:
            msg += f"\n  💡 {self.suggestion}"
        super().__init__(msg)

    @classmethod
    def from_response(cls, status_code: int, body: dict[str, Any]) -> APIError:
        """Create the most specific error subclass from an API error response."""
        error = body.get("error", {})
        code = error.get("code", "UNKNOWN")
        message = error.get("message", "Unknown error")
        details = error.get("details")

        error_cls = _STATUS_MAP.get(status_code, APIError)
        return error_cls(
            status_code=status_code,
            code=code,
            message=message,
            details=details,
        )


class AuthenticationError(APIError):
    """Raised on 401 responses."""


class PaymentRequiredError(APIError):
    """Raised on 402 responses when x402 payment also fails."""


class ForbiddenError(APIError):
    """Raised on 403 responses."""


class NotFoundError(APIError):
    """Raised on 404 responses."""


class ValidationError(APIError):
    """Raised on 400/422 responses."""


class RateLimitError(APIError):
    """Raised on 429 responses."""


class InternalServerError(APIError):
    """Raised on 500 responses."""


_STATUS_MAP: dict[int, type[APIError]] = {
    400: ValidationError,
    401: AuthenticationError,
    402: PaymentRequiredError,
    403: ForbiddenError,
    404: NotFoundError,
    422: ValidationError,
    429: RateLimitError,
    500: InternalServerError,
}
