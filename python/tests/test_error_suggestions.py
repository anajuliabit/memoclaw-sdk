"""Tests for rich error types with suggestions."""

from memoclaw.errors import APIError, NotFoundError, RateLimitError, ValidationError


class TestErrorSuggestions:
    def test_not_found_has_suggestion(self):
        err = NotFoundError(404, "NOT_FOUND", "Memory not found")
        assert err.suggestion is not None
        assert "list()" in err.suggestion
        assert "💡" in str(err)

    def test_rate_limit_has_suggestion(self):
        err = RateLimitError(429, "RATE_LIMITED", "Too many requests")
        assert err.suggestion is not None
        assert "retry" in err.suggestion.lower() or "delays" in err.suggestion.lower()

    def test_validation_has_suggestion(self):
        err = ValidationError(422, "VALIDATION_ERROR", "Content too long")
        assert err.suggestion is not None
        assert "8192" in err.suggestion

    def test_unknown_code_no_suggestion(self):
        err = APIError(418, "TEAPOT", "I'm a teapot")
        assert err.suggestion is None
        assert "💡" not in str(err)

    def test_code_specific_suggestion_takes_priority(self):
        """Error code suggestion should be preferred over status fallback."""
        err = APIError(401, "INVALID_SIGNATURE", "Bad sig")
        assert err.suggestion is not None
        assert "private key" in err.suggestion

    def test_status_fallback_for_unknown_code(self):
        """Unknown code should fall back to status-based suggestion."""
        err = APIError(502, "SOMETHING_WEIRD", "Bad gateway")
        assert err.suggestion is not None
        assert "restarting" in err.suggestion.lower() or "gateway" in err.suggestion.lower()

    def test_payment_suggestions(self):
        err = APIError(402, "FREE_TIER_EXHAUSTED", "No more free calls")
        assert err.suggestion is not None
        assert "100 free" in err.suggestion

    def test_forbidden_suggestions(self):
        err = APIError(403, "MEMORY_IMMUTABLE", "Cannot modify")
        assert err.suggestion is not None
        assert "immutable" in err.suggestion

    def test_content_too_long_suggestion(self):
        err = ValidationError(400, "CONTENT_TOO_LONG", "Too long")
        assert err.suggestion is not None
        assert "8192" in err.suggestion

    def test_from_response_preserves_suggestion(self):
        err = APIError.from_response(
            404, {"error": {"code": "NOT_FOUND", "message": "Not found"}}
        )
        assert isinstance(err, NotFoundError)
        assert err.suggestion is not None
