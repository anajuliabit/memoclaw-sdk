"""Tests for structured logging support (issue #130)."""

from __future__ import annotations

import json
import logging

import pytest

from memoclaw._client import (
    LogFormat,
    LogLevel,
    _StructuredJsonFormatter,
    configure_sdk_logging,
)


class TestConfigureSdkLogging:
    """Test the configure_sdk_logging() helper."""

    def setup_method(self) -> None:
        """Reset the memoclaw logger between tests."""
        sdk_logger = logging.getLogger("memoclaw")
        sdk_logger.handlers = [
            h for h in sdk_logger.handlers if not getattr(h, "_memoclaw_sdk", False)
        ]
        sdk_logger.setLevel(logging.WARNING)

    def test_text_format_default(self, caplog: pytest.LogCaptureFixture) -> None:
        configure_sdk_logging(level="DEBUG", log_format="text")
        sdk_logger = logging.getLogger("memoclaw")
        assert sdk_logger.level == logging.DEBUG
        sdk_handlers = [h for h in sdk_logger.handlers if getattr(h, "_memoclaw_sdk", False)]
        assert len(sdk_handlers) == 1
        assert not isinstance(sdk_handlers[0].formatter, _StructuredJsonFormatter)

    def test_json_format(self) -> None:
        configure_sdk_logging(level="INFO", log_format="json")
        sdk_logger = logging.getLogger("memoclaw")
        assert sdk_logger.level == logging.INFO
        sdk_handlers = [h for h in sdk_logger.handlers if getattr(h, "_memoclaw_sdk", False)]
        assert len(sdk_handlers) == 1
        assert isinstance(sdk_handlers[0].formatter, _StructuredJsonFormatter)

    def test_no_duplicate_handlers(self) -> None:
        configure_sdk_logging(level="DEBUG")
        configure_sdk_logging(level="INFO")
        configure_sdk_logging(level="WARNING")
        sdk_logger = logging.getLogger("memoclaw")
        sdk_handlers = [h for h in sdk_logger.handlers if getattr(h, "_memoclaw_sdk", False)]
        assert len(sdk_handlers) == 1

    def test_level_names_mapped_correctly(self) -> None:
        for name, expected in [
            ("DEBUG", logging.DEBUG),
            ("INFO", logging.INFO),
            ("WARNING", logging.WARNING),
            ("ERROR", logging.ERROR),
            ("CRITICAL", logging.CRITICAL),
        ]:
            configure_sdk_logging(level=name)
            sdk_logger = logging.getLogger("memoclaw")
            assert sdk_logger.level == expected, f"Failed for {name}"

    def test_integer_level(self) -> None:
        configure_sdk_logging(level=logging.ERROR)
        sdk_logger = logging.getLogger("memoclaw")
        assert sdk_logger.level == logging.ERROR


class TestStructuredJsonFormatter:
    """Test the _StructuredJsonFormatter output."""

    def test_basic_json_output(self) -> None:
        formatter = _StructuredJsonFormatter()
        record = logging.LogRecord(
            name="memoclaw",
            level=logging.DEBUG,
            pathname="",
            lineno=0,
            msg="GET /v1/memories → 200 (42ms)",
            args=(),
            exc_info=None,
        )
        output = formatter.format(record)
        parsed = json.loads(output)
        assert parsed["level"] == "DEBUG"
        assert parsed["logger"] == "memoclaw"
        assert "GET /v1/memories" in parsed["message"]

    def test_structured_extra_fields(self) -> None:
        formatter = _StructuredJsonFormatter()
        record = logging.LogRecord(
            name="memoclaw",
            level=logging.DEBUG,
            pathname="",
            lineno=0,
            msg="GET /v1/memories → 200 (42ms)",
            args=(),
            exc_info=None,
        )
        record.method = "GET"  # type: ignore[attr-defined]
        record.path = "/v1/memories"  # type: ignore[attr-defined]
        record.status = 200  # type: ignore[attr-defined]
        record.duration_ms = 42  # type: ignore[attr-defined]
        record.request_id = "req-abc-123"  # type: ignore[attr-defined]

        output = formatter.format(record)
        parsed = json.loads(output)
        assert parsed["method"] == "GET"
        assert parsed["path"] == "/v1/memories"
        assert parsed["status"] == 200
        assert parsed["duration_ms"] == 42
        assert parsed["request_id"] == "req-abc-123"

    def test_missing_extra_fields_omitted(self) -> None:
        formatter = _StructuredJsonFormatter()
        record = logging.LogRecord(
            name="memoclaw",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg="Hello",
            args=(),
            exc_info=None,
        )
        output = formatter.format(record)
        parsed = json.loads(output)
        assert "method" not in parsed
        assert "status" not in parsed
        assert "request_id" not in parsed


class TestClientLogParams:
    """Test that MemoClaw/AsyncMemoClaw accept log_level/log_format."""

    def test_memoclaw_accepts_log_level(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Verify MemoClaw constructor accepts log_level without error."""
        monkeypatch.delenv("MEMOCLAW_PRIVATE_KEY", raising=False)
        monkeypatch.delenv("MEMOCLAW_WALLET", raising=False)
        from memoclaw.client import MemoClaw
        # Pass a dummy wallet so it doesn't need a config file
        client = MemoClaw(wallet_address="0xdead", log_level="INFO", log_format="json")
        assert client is not None

    def test_async_memoclaw_accepts_log_level(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Verify AsyncMemoClaw constructor accepts log_level without error."""
        monkeypatch.delenv("MEMOCLAW_PRIVATE_KEY", raising=False)
        monkeypatch.delenv("MEMOCLAW_WALLET", raising=False)
        from memoclaw.client import AsyncMemoClaw
        client = AsyncMemoClaw(wallet_address="0xdead", log_level="DEBUG", log_format="text")
        assert client is not None

    def test_log_level_none_does_not_configure(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """When log_level is None (default), configure_sdk_logging should not be called."""
        monkeypatch.delenv("MEMOCLAW_PRIVATE_KEY", raising=False)
        monkeypatch.delenv("MEMOCLAW_WALLET", raising=False)
        sdk_logger = logging.getLogger("memoclaw")
        # Reset any prior SDK handlers
        sdk_logger.handlers = [h for h in sdk_logger.handlers if not getattr(h, "_memoclaw_sdk", False)]
        initial_handlers = len([h for h in sdk_logger.handlers if getattr(h, "_memoclaw_sdk", False)])
        from memoclaw.client import MemoClaw
        MemoClaw(wallet_address="0xdead")  # log_level defaults to None
        final_handlers = len([h for h in sdk_logger.handlers if getattr(h, "_memoclaw_sdk", False)])
        assert final_handlers == initial_handlers
