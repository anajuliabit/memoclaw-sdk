from __future__ import annotations

import httpx
import pytest

from memoclaw._client import _SyncHTTPClient

try:
    from opentelemetry import trace
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import InMemorySpanExporter, SimpleSpanProcessor
except ImportError:  # pragma: no cover - tests guarded by extra dependency
    trace = None  # type: ignore


pytestmark = pytest.mark.skipif(trace is None, reason="opentelemetry not installed")


@pytest.fixture()
def otel_exporter() -> InMemorySpanExporter:
    provider = TracerProvider()
    exporter = InMemorySpanExporter()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
    yield exporter
    exporter.clear()
    provider.shutdown()
    trace.disable()  # type: ignore[attr-defined]


def make_response(status: int = 200, body: dict | None = None) -> httpx.Response:
    request = httpx.Request("GET", "https://api.memoclaw.com/v1/free-tier/status")
    return httpx.Response(status, request=request, json=body or {"wallet": "0xabc", "free_tier_remaining": 1})


def test_tracing_injects_traceparent(otel_exporter: InMemorySpanExporter) -> None:
    client = _SyncHTTPClient(wallet_address="0xabc", enable_tracing=True)

    captured_headers: dict[str, str] = {}

    def fake_request(*args, **kwargs):  # type: ignore[no-untyped-def]
        nonlocal captured_headers
        captured_headers = kwargs.get("headers", {})
        return make_response()

    client._http.request = fake_request  # type: ignore[attr-defined]

    resp = client.request("GET", "/v1/free-tier/status")
    assert resp["wallet"] == "0xabc"
    traceparent = captured_headers.get("traceparent")
    assert traceparent is not None
    assert traceparent.startswith("00-")
    spans = otel_exporter.get_finished_spans()
    assert spans, "expected tracing span"
    span = spans[0]
    assert span.attributes["memoclaw.method"] == "GET"
    assert span.attributes["memoclaw.status"] == 200


def test_tracing_records_errors(otel_exporter: InMemorySpanExporter) -> None:
    client = _SyncHTTPClient(wallet_address="0xabc", enable_tracing=True)

    def fake_request(*args, **kwargs):  # type: ignore[no-untyped-def]
        raise httpx.ConnectError("boom")

    client._http.request = fake_request  # type: ignore[attr-defined]

    with pytest.raises(httpx.ConnectError):
        client.request("GET", "/v1/free-tier/status")

    spans = otel_exporter.get_finished_spans()
    assert spans, "expected tracing span"
    span = spans[0]
    assert span.attributes["memoclaw.error"] == "ConnectError"
