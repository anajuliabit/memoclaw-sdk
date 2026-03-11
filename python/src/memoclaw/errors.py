"""Exception hierarchy for the MemoClaw SDK."""

from __future__ import annotations

from typing import Any


class MemoClawError(Exception):
    """Base exception for all MemoClaw SDK errors."""


# ── Suggestions for common errors ────────────────────────────────────────────

# Actionable suggestions keyed by error code (matched first, then status fallback).
_CODE_SUGGESTIONS: dict[str, str] = {
    # Auth
    "MISSING_WALLET": "Pass a wallet address via the `wallet` option, set MEMOCLAW_WALLET env var, or run `memoclaw init`.",
    "INVALID_WALLET": "Ensure the wallet address is a valid Ethereum address (0x-prefixed, 40 hex chars).",
    "INVALID_SIGNATURE": "The signed auth header is invalid. Check that your private key matches the wallet address.",
    "AUTH_EXPIRED": "The authentication timestamp has expired. Ensure your system clock is accurate.",
    "AUTH_ERROR": "Check that your private key is correct and the signature hasn't expired. Ensure system clock is synced.",
    # Payment
    "FREE_TIER_EXHAUSTED": "You have used all 100 free API calls. Fund your wallet with USDC on Base to continue. See https://docs.memoclaw.com/payments",
    "PAYMENT_REQUIRED": "This endpoint requires payment. Ensure your wallet has USDC on Base. See https://docs.memoclaw.com/payments",
    "INSUFFICIENT_FUNDS": "Your wallet does not have enough USDC on Base. Top up and retry.",
    # Validation
    "CONTENT_TOO_LONG": "Memory content exceeds the 8192 character limit. Split it into smaller memories or summarize.",
    "INVALID_IMPORTANCE": "Importance must be a number between 0 and 1.",
    "INVALID_NAMESPACE": "Namespace must be alphanumeric with hyphens/underscores, max 64 chars.",
    "MISSING_CONTENT": "The `content` field is required and must be a non-empty string.",
    "MISSING_QUERY": "The `query` field is required for recall/search.",
    "BATCH_TOO_LARGE": "Batch size exceeds the maximum of 100 items. Split into smaller batches.",
    "VALIDATION_ERROR": "Check request payload — content max length is 8192 chars, importance must be 0.0-1.0.",
    # Not found
    "MEMORY_NOT_FOUND": "No memory exists with that ID. It may have been deleted. Use `client.list()` to browse existing memories.",
    "NOT_FOUND": "The memory ID may have been deleted or never existed. Use client.list() to verify.",
    "RELATION_NOT_FOUND": "No relation exists with that ID. Use `client.list_relations(memory_id)` to see existing relations.",
    # Forbidden
    "MEMORY_IMMUTABLE": "This memory is immutable and cannot be modified or deleted.",
    "WALLET_MISMATCH": "You can only access memories belonging to your wallet address.",
    # Rate limit
    "RATE_LIMITED": "Too many requests. The SDK retries automatically, but consider adding delays between batch operations.",
    # Server
    "INTERNAL_ERROR": "An unexpected server error occurred. Retry in a moment. If it persists, check https://status.memoclaw.com",
    "SERVICE_UNAVAILABLE": "The API is temporarily unavailable. Retry in a few seconds.",
}

# Fallback suggestions by HTTP status code when no specific error code matches.
_STATUS_SUGGESTIONS: dict[int, str] = {
    400: "Check the request body against the API docs: https://docs.memoclaw.com",
    401: "Verify your wallet address or private key. Run `memoclaw init` to reconfigure.",
    402: "This request requires payment. Ensure your wallet has USDC on Base. See https://docs.memoclaw.com/payments",
    403: "You do not have permission for this resource. Check the wallet address and memory ownership.",
    404: "The requested resource was not found. Verify the ID and that it has not been deleted.",
    422: "The request body has invalid fields. Check types and required fields in the API docs.",
    429: "Rate limited. Slow down requests or add retry logic with exponential backoff.",
    500: "Internal server error. Retry shortly. If persistent, report at https://github.com/anajuliabit/memocloud/issues",
    502: "Bad gateway. The API may be restarting. Retry in a few seconds.",
    503: "Service unavailable. The API is temporarily down. Retry shortly.",
    504: "Gateway timeout. The request took too long. Try a smaller batch or simpler query.",
}


def _get_suggestion(status_code: int, code: str) -> str | None:
    """Look up an actionable suggestion for a given error code and status."""
    return _CODE_SUGGESTIONS.get(code) or _STATUS_SUGGESTIONS.get(status_code)


class APIError(MemoClawError):
    """Raised when the API returns a non-2xx response.

    Attributes:
        status_code: HTTP status code.
        code: Error code from the API (e.g. ``"NOT_FOUND"``).
        message: Human-readable error message.
        details: Optional structured error details.
        suggestion: Actionable suggestion for fixing the error.
        request_id: Server-side request ID from the ``x-request-id`` header, if available.
        retry_attempts: Number of retry attempts made before this error was raised.
            ``0`` means the error occurred on the first attempt with no retries.
    """

    status_code: int
    code: str
    message: str
    details: dict[str, Any] | None
    suggestion: str | None
    request_id: str | None
    retry_attempts: int

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: dict[str, Any] | None = None,
        *,
        request_id: str | None = None,
        retry_attempts: int = 0,
    ) -> None:
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details
        self.request_id = request_id
        self.retry_attempts = retry_attempts
        self.suggestion = _get_suggestion(status_code, code)
        msg = f"[{status_code}] {code}: {message}"
        if self.request_id:
            msg += f"\n  request-id: {self.request_id}"
        if self.retry_attempts > 0:
            msg += f"\n  retries: {self.retry_attempts}"
        if self.suggestion:
            msg += f"\n  💡 {self.suggestion}"
        super().__init__(msg)

    @classmethod
    def from_response(
        cls,
        status_code: int,
        body: dict[str, Any],
        *,
        request_id: str | None = None,
        retry_attempts: int = 0,
    ) -> APIError:
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
            request_id=request_id,
            retry_attempts=retry_attempts,
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
    502: InternalServerError,
    503: InternalServerError,
    504: InternalServerError,
}
