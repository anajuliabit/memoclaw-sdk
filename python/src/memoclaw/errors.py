"""Exception hierarchy for the MemoClaw SDK."""

from __future__ import annotations

from typing import Any


class MemoClawError(Exception):
    """Base exception for all MemoClaw SDK errors."""


class APIError(MemoClawError):
    """Raised when the API returns a non-2xx response."""

    status_code: int
    code: str
    message: str
    details: dict[str, Any] | None

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
        super().__init__(f"[{status_code}] {code}: {message}")

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
