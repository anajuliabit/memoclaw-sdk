"""Tests for request ID surfacing and debug logging."""

import logging

from memoclaw.errors import APIError, NotFoundError


class TestRequestId:
    def test_request_id_in_error(self):
        err = NotFoundError(404, "NOT_FOUND", "Memory not found", request_id="req-abc-123")
        assert err.request_id == "req-abc-123"
        assert "req-abc-123" in str(err)

    def test_request_id_none_when_absent(self):
        err = APIError(404, "NOT_FOUND", "Memory not found")
        assert err.request_id is None
        assert "request-id" not in str(err)

    def test_from_response_passes_request_id(self):
        err = APIError.from_response(
            404,
            {"error": {"code": "NOT_FOUND", "message": "Not found"}},
            request_id="req-xyz-789",
        )
        assert isinstance(err, NotFoundError)
        assert err.request_id == "req-xyz-789"
        assert "req-xyz-789" in str(err)

    def test_from_response_no_request_id(self):
        err = APIError.from_response(
            404,
            {"error": {"code": "NOT_FOUND", "message": "Not found"}},
        )
        assert err.request_id is None


class TestDebugLogging:
    def test_memoclaw_logger_exists(self):
        """The memoclaw logger should be accessible via logging.getLogger."""
        log = logging.getLogger("memoclaw")
        assert log is not None
        assert log.name == "memoclaw"

    def test_logger_no_output_by_default(self, caplog):
        """Logger should not produce output without explicit configuration."""
        log = logging.getLogger("memoclaw")
        with caplog.at_level(logging.WARNING, logger="memoclaw"):
            log.debug("this should not appear")
        assert "this should not appear" not in caplog.text
