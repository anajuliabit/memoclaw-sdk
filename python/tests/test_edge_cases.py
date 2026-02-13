"""Edge case tests for MemoClaw SDK — error handling, retries, auth failures."""

from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest
import respx

from memoclaw import MemoClaw, AsyncMemoClaw
from memoclaw.errors import (
    APIError,
    AuthenticationError,
    InternalServerError,
    RateLimitError,
    ValidationError,
)

TEST_PRIVATE_KEY = "0x4c0883a69102937d6231471b5dbb6204fe512961708279f15a8f7e20b4e3b1fb"
BASE_URL = "https://api.memoclaw.com"


@pytest.fixture
def client():
    c = MemoClaw(private_key=TEST_PRIVATE_KEY, base_url=BASE_URL)
    yield c
    c.close()


class TestAuthFailures:
    @respx.mock
    def test_401_raises_authentication_error(self, client: MemoClaw):
        respx.get(f"{BASE_URL}/v1/free-tier/status").mock(
            return_value=httpx.Response(
                401,
                json={"error": {"code": "AUTH_ERROR", "message": "Invalid signature"}},
            )
        )
        with pytest.raises(AuthenticationError) as exc_info:
            client.status()
        assert exc_info.value.status_code == 401
        assert exc_info.value.code == "AUTH_ERROR"

    @respx.mock
    def test_401_with_expired_timestamp(self, client: MemoClaw):
        respx.post(f"{BASE_URL}/v1/store").mock(
            return_value=httpx.Response(
                401,
                json={"error": {"code": "AUTH_ERROR", "message": "Timestamp expired"}},
            )
        )
        with pytest.raises(AuthenticationError):
            client.store("test content")


class TestServerErrors:
    @respx.mock
    def test_500_raises_internal_server_error(self, client: MemoClaw):
        respx.post(f"{BASE_URL}/v1/store").mock(
            return_value=httpx.Response(
                500,
                json={"error": {"code": "INTERNAL_ERROR", "message": "Database connection failed"}},
            )
        )
        with pytest.raises(InternalServerError):
            client.store("test")

    @respx.mock
    def test_non_json_error_response(self, client: MemoClaw):
        """Server returns non-JSON error (e.g. nginx 502 page)."""
        respx.post(f"{BASE_URL}/v1/store").mock(
            return_value=httpx.Response(
                500,
                text="<html>Bad Gateway</html>",
                headers={"content-type": "text/html"},
            )
        )
        with pytest.raises(APIError) as exc_info:
            client.store("test")
        assert exc_info.value.code == "UNKNOWN"

    @respx.mock
    def test_empty_error_body(self, client: MemoClaw):
        respx.post(f"{BASE_URL}/v1/store").mock(
            return_value=httpx.Response(500, text="")
        )
        with pytest.raises(APIError):
            client.store("test")


class TestRateLimiting:
    @respx.mock
    def test_429_raises_rate_limit_error(self, client: MemoClaw):
        respx.post(f"{BASE_URL}/v1/recall").mock(
            return_value=httpx.Response(
                429,
                json={"error": {"code": "RATE_LIMITED", "message": "Too many requests"}},
            )
        )
        with pytest.raises(RateLimitError):
            client.recall("test query")


class TestValidationEdgeCases:
    @respx.mock
    def test_validation_error_with_details(self, client: MemoClaw):
        respx.post(f"{BASE_URL}/v1/store").mock(
            return_value=httpx.Response(
                422,
                json={
                    "error": {
                        "code": "VALIDATION_ERROR",
                        "message": "Content too long",
                        "details": {"max_length": 8192, "actual_length": 10000},
                    }
                },
            )
        )
        with pytest.raises(ValidationError) as exc_info:
            client.store("x" * 10000)
        assert exc_info.value.details == {"max_length": 8192, "actual_length": 10000}


class TestStoreBatch:
    @respx.mock
    def test_store_batch(self, client: MemoClaw):
        respx.post(f"{BASE_URL}/v1/store/batch").mock(
            return_value=httpx.Response(
                201,
                json={
                    "ids": ["m1", "m2", "m3"],
                    "stored": True,
                    "count": 3,
                    "tokens_used": 120,
                    "deduplicated_count": 0,
                },
            )
        )
        result = client.store_batch([
            {"content": "Memory one", "importance": 0.7},
            {"content": "Memory two", "importance": 0.8},
            {"content": "Memory three"},
        ])
        assert len(result.ids) == 3
        assert result.tokens_used == 120

    @respx.mock
    def test_store_batch_with_dedup(self, client: MemoClaw):
        respx.post(f"{BASE_URL}/v1/store/batch").mock(
            return_value=httpx.Response(
                201,
                json={
                    "ids": ["m1", "m2"],
                    "stored": True,
                    "count": 2,
                    "tokens_used": 80,
                    "deduplicated_count": 1,
                },
            )
        )
        result = client.store_batch([
            {"content": "Same thing"},
            {"content": "Same thing slightly different"},
        ])
        assert result.deduplicated_count == 1


class TestUpdateEdgeCases:
    @respx.mock
    def test_update_nonexistent_returns_404(self, client: MemoClaw):
        from memoclaw.errors import NotFoundError

        respx.patch(f"{BASE_URL}/v1/memories/nonexistent-id").mock(
            return_value=httpx.Response(
                404,
                json={"error": {"code": "NOT_FOUND", "message": "Memory not found"}},
            )
        )
        with pytest.raises(NotFoundError):
            client.update("nonexistent-id", content="new content")


class TestNoContent204:
    @respx.mock
    def test_204_returns_empty_dict(self, client: MemoClaw):
        """Some endpoints may return 204 No Content."""
        respx.delete(f"{BASE_URL}/v1/memories/m1").mock(
            return_value=httpx.Response(204)
        )
        # The _client.py returns {} for 204
        # This tests the raw client behavior
        result = client._http.request("DELETE", "/v1/memories/m1")
        assert result == {}


class TestCustomBaseUrl:
    def test_custom_base_url(self):
        c = MemoClaw(private_key=TEST_PRIVATE_KEY, base_url="https://custom.api.com/")
        assert c._http._base_url == "https://custom.api.com"
        c.close()

    def test_trailing_slash_stripped(self):
        c = MemoClaw(private_key=TEST_PRIVATE_KEY, base_url="https://api.example.com///")
        assert c._http._base_url == "https://api.example.com"
        c.close()


class TestCustomTimeout:
    def test_custom_timeout(self):
        c = MemoClaw(private_key=TEST_PRIVATE_KEY, timeout=5.0)
        assert c._http._timeout == 5.0
        c.close()


class TestIngestEdgeCases:
    @respx.mock
    def test_ingest_with_text(self, client: MemoClaw):
        respx.post(f"{BASE_URL}/v1/ingest").mock(
            return_value=httpx.Response(
                201,
                json={
                    "memory_ids": ["a"],
                    "facts_extracted": 1,
                    "facts_stored": 1,
                    "facts_deduplicated": 0,
                    "relations_created": 0,
                    "tokens_used": 50,
                },
            )
        )
        result = client.ingest(text="User prefers dark mode and vim keybindings")
        assert result.facts_extracted == 1

    @respx.mock
    def test_ingest_with_namespace(self, client: MemoClaw):
        route = respx.post(f"{BASE_URL}/v1/ingest").mock(
            return_value=httpx.Response(
                201,
                json={
                    "memory_ids": [],
                    "facts_extracted": 0,
                    "facts_stored": 0,
                    "facts_deduplicated": 0,
                    "relations_created": 0,
                    "tokens_used": 10,
                },
            )
        )
        client.ingest(
            messages=[{"role": "user", "content": "hello"}],
            namespace="project-x",
            session_id="sess1",
            agent_id="agent1",
        )
        body = route.calls[0].request.content
        assert b"project-x" in body


class TestConsolidateEdgeCases:
    @respx.mock
    def test_consolidate_dry_run(self, client: MemoClaw):
        respx.post(f"{BASE_URL}/v1/memories/consolidate").mock(
            return_value=httpx.Response(
                200,
                json={
                    "clusters_found": 2,
                    "memories_merged": 0,
                    "memories_created": 0,
                    "clusters": [
                        {"memory_ids": ["a", "b"], "similarity": 0.95, "merged_into": None},
                        {"memory_ids": ["c", "d"], "similarity": 0.91, "merged_into": None},
                    ],
                },
            )
        )
        result = client.consolidate(dry_run=True)
        assert result.clusters_found == 2
        assert result.memories_merged == 0

    @respx.mock
    def test_consolidate_no_clusters(self, client: MemoClaw):
        respx.post(f"{BASE_URL}/v1/memories/consolidate").mock(
            return_value=httpx.Response(
                200,
                json={
                    "clusters_found": 0,
                    "memories_merged": 0,
                    "memories_created": 0,
                    "clusters": [],
                },
            )
        )
        result = client.consolidate()
        assert result.clusters_found == 0
        assert len(result.clusters) == 0
