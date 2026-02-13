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

    def test_from_response_preserves_suggestion(self):
        err = APIError.from_response(
            404, {"error": {"code": "NOT_FOUND", "message": "Not found"}}
        )
        assert isinstance(err, NotFoundError)
        assert err.suggestion is not None
