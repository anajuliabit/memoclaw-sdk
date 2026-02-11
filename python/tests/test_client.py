"""Tests for MemoClaw sync client (mocked HTTP)."""

from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest
import respx

from memoclaw import (
    AsyncMemoClaw,
    MemoClaw,
    NotFoundError,
    StoreResult,
    ValidationError,
)

# A valid Ethereum private key for testing (DO NOT use in production)
TEST_PRIVATE_KEY = "0x4c0883a69102937d6231471b5dbb6204fe512961708279f15a8f7e20b4e3b1fb"
BASE_URL = "https://api.memoclaw.com"


@pytest.fixture
def client():
    c = MemoClaw(private_key=TEST_PRIVATE_KEY, base_url=BASE_URL)
    yield c
    c.close()


@pytest.fixture
def async_client():
    return AsyncMemoClaw(private_key=TEST_PRIVATE_KEY, base_url=BASE_URL)


def _assert_wallet_auth_header(request: httpx.Request):
    """Validate x-wallet-auth header format: {address}:{timestamp}:{signature}."""
    auth = request.headers.get("x-wallet-auth", "")
    parts = auth.split(":")
    # address:timestamp:signature (signature is hex without 0x, so no extra colons)
    assert len(parts) == 3, f"Expected 3 parts in wallet auth, got {len(parts)}: {auth}"
    address, timestamp, signature = parts
    assert address.startswith("0x"), "Address should start with 0x"
    assert len(address) == 42, "Address should be 42 chars"
    assert timestamp.isdigit(), "Timestamp should be numeric"
    assert len(signature) > 0, "Signature should not be empty"


class TestWalletAuth:
    @respx.mock
    def test_auth_header_format(self, client: MemoClaw):
        route = respx.get(f"{BASE_URL}/v1/free-tier/status").mock(
            return_value=httpx.Response(
                200,
                json={
                    "wallet": "0x2c7536E3605D9C16a7a3D7b1898e529396a65c23",
                    "free_tier_remaining": 1000,
                    "free_tier_total": 1000,
                    "free_tier_used": 0,
                },
            )
        )
        client.status()
        assert route.called
        _assert_wallet_auth_header(route.calls[0].request)


class TestStore:
    @respx.mock
    def test_store_basic(self, client: MemoClaw):
        respx.post(f"{BASE_URL}/v1/store").mock(
            return_value=httpx.Response(
                201,
                json={
                    "id": "mem-123",
                    "stored": True,
                    "deduplicated": False,
                    "tokens_used": 42,
                },
            )
        )
        result = client.store("User prefers tabs", importance=0.8, tags=["prefs"])
        assert isinstance(result, StoreResult)
        assert result.id == "mem-123"
        assert result.tokens_used == 42

    @respx.mock
    def test_store_with_all_options(self, client: MemoClaw):
        route = respx.post(f"{BASE_URL}/v1/store").mock(
            return_value=httpx.Response(
                201,
                json={
                    "id": "mem-456",
                    "stored": True,
                    "deduplicated": True,
                    "tokens_used": 30,
                },
            )
        )
        result = client.store(
            "Test content",
            importance=0.9,
            tags=["a", "b"],
            namespace="project",
            memory_type="preference",
            session_id="sess1",
            agent_id="agent1",
            expires_at="2026-01-01T00:00:00Z",
        )
        assert result.deduplicated is True
        # Verify body was sent correctly
        body = route.calls[0].request.content
        assert b"Test content" in body


class TestRecall:
    @respx.mock
    def test_recall_basic(self, client: MemoClaw):
        respx.post(f"{BASE_URL}/v1/recall").mock(
            return_value=httpx.Response(
                200,
                json={
                    "memories": [
                        {
                            "id": "m1",
                            "content": "User prefers tabs",
                            "similarity": 0.95,
                            "metadata": {"tags": ["prefs"]},
                            "importance": 0.8,
                            "memory_type": "preference",
                            "namespace": "default",
                            "session_id": None,
                            "agent_id": None,
                            "created_at": "2025-01-01T00:00:00Z",
                            "access_count": 3,
                        }
                    ],
                    "query_tokens": 5,
                },
            )
        )
        result = client.recall("code preferences", limit=5)
        assert len(result.memories) == 1
        assert result.memories[0].similarity == 0.95
        assert result.query_tokens == 5


class TestUpdate:
    @respx.mock
    def test_update_content(self, client: MemoClaw):
        respx.patch(f"{BASE_URL}/v1/memories/mem-123").mock(
            return_value=httpx.Response(
                200,
                json={
                    "id": "mem-123",
                    "user_id": "u1",
                    "namespace": "default",
                    "content": "Updated content",
                    "embedding_model": "text-embedding-3-small",
                    "metadata": {},
                    "importance": 0.9,
                    "memory_type": "general",
                    "session_id": None,
                    "agent_id": None,
                    "created_at": "2025-01-01T00:00:00Z",
                    "updated_at": "2025-06-01T00:00:00Z",
                    "accessed_at": "2025-01-01T00:00:00Z",
                    "access_count": 1,
                    "deleted_at": None,
                    "expires_at": None,
                },
            )
        )
        result = client.update("mem-123", content="Updated content", importance=0.9)
        assert result.content == "Updated content"
        assert result.importance == 0.9


class TestDelete:
    @respx.mock
    def test_delete(self, client: MemoClaw):
        respx.delete(f"{BASE_URL}/v1/memories/mem-123").mock(
            return_value=httpx.Response(
                200, json={"deleted": True, "id": "mem-123"}
            )
        )
        result = client.delete("mem-123")
        assert result.deleted is True
        assert result.id == "mem-123"


class TestList:
    @respx.mock
    def test_list_basic(self, client: MemoClaw):
        respx.get(f"{BASE_URL}/v1/memories").mock(
            return_value=httpx.Response(
                200,
                json={
                    "memories": [],
                    "total": 0,
                    "limit": 20,
                    "offset": 0,
                },
            )
        )
        result = client.list()
        assert result.total == 0


class TestIngest:
    @respx.mock
    def test_ingest_messages(self, client: MemoClaw):
        respx.post(f"{BASE_URL}/v1/ingest").mock(
            return_value=httpx.Response(
                201,
                json={
                    "memory_ids": ["a", "b"],
                    "facts_extracted": 3,
                    "facts_stored": 2,
                    "facts_deduplicated": 1,
                    "relations_created": 1,
                    "tokens_used": 150,
                },
            )
        )
        result = client.ingest(
            messages=[
                {"role": "user", "content": "I prefer Python over JS"},
                {"role": "assistant", "content": "Noted!"},
            ]
        )
        assert result.facts_extracted == 3
        assert len(result.memory_ids) == 2


class TestExtract:
    @respx.mock
    def test_extract(self, client: MemoClaw):
        respx.post(f"{BASE_URL}/v1/memories/extract").mock(
            return_value=httpx.Response(
                201,
                json={
                    "memory_ids": ["a"],
                    "facts_extracted": 1,
                    "facts_stored": 1,
                    "facts_deduplicated": 0,
                    "tokens_used": 50,
                },
            )
        )
        result = client.extract([{"role": "user", "content": "I use vim"}])
        assert result.facts_extracted == 1


class TestConsolidate:
    @respx.mock
    def test_consolidate(self, client: MemoClaw):
        respx.post(f"{BASE_URL}/v1/memories/consolidate").mock(
            return_value=httpx.Response(
                200,
                json={
                    "clusters_found": 1,
                    "memories_merged": 2,
                    "memories_created": 1,
                    "clusters": [
                        {
                            "memory_ids": ["a", "b"],
                            "similarity": 0.92,
                            "merged_into": "c",
                        }
                    ],
                },
            )
        )
        result = client.consolidate(min_similarity=0.85)
        assert result.clusters_found == 1
        assert result.clusters[0].merged_into == "c"


class TestSuggested:
    @respx.mock
    def test_suggested(self, client: MemoClaw):
        respx.get(f"{BASE_URL}/v1/suggested").mock(
            return_value=httpx.Response(
                200,
                json={
                    "suggested": [
                        {
                            "id": "s1",
                            "content": "stale memory",
                            "metadata": {},
                            "importance": 0.8,
                            "memory_type": "general",
                            "namespace": "default",
                            "session_id": None,
                            "agent_id": None,
                            "created_at": "2025-01-01T00:00:00Z",
                            "accessed_at": "2025-01-01T00:00:00Z",
                            "access_count": 0,
                            "relation_count": 0,
                            "category": "stale",
                            "review_score": 0.75,
                        }
                    ],
                    "categories": {"stale": 1},
                    "total": 1,
                },
            )
        )
        result = client.suggested(category="stale")
        assert result.total == 1
        assert result.suggested[0].category == "stale"


class TestRelations:
    @respx.mock
    def test_create_relation(self, client: MemoClaw):
        respx.post(f"{BASE_URL}/v1/memories/m1/relations").mock(
            return_value=httpx.Response(
                201,
                json={
                    "id": "rel1",
                    "source_id": "m1",
                    "target_id": "m2",
                    "relation_type": "related_to",
                    "metadata": {},
                    "created_at": "2025-01-01T00:00:00Z",
                },
            )
        )
        result = client.create_relation("m1", "m2", "related_to")
        assert result.id == "rel1"
        assert result.relation_type == "related_to"

    @respx.mock
    def test_list_relations(self, client: MemoClaw):
        respx.get(f"{BASE_URL}/v1/memories/m1/relations").mock(
            return_value=httpx.Response(200, json={"relations": []})
        )
        result = client.list_relations("m1")
        assert result == []

    @respx.mock
    def test_delete_relation(self, client: MemoClaw):
        respx.delete(f"{BASE_URL}/v1/memories/m1/relations/rel1").mock(
            return_value=httpx.Response(200, json={"deleted": True})
        )
        result = client.delete_relation("m1", "rel1")
        assert result.deleted is True


class TestStatus:
    @respx.mock
    def test_status(self, client: MemoClaw):
        respx.get(f"{BASE_URL}/v1/free-tier/status").mock(
            return_value=httpx.Response(
                200,
                json={
                    "wallet": "0xabc",
                    "free_tier_remaining": 950,
                    "free_tier_total": 1000,
                    "free_tier_used": 50,
                },
            )
        )
        result = client.status()
        assert result.free_tier_remaining == 950


class TestErrorMapping:
    @respx.mock
    def test_404_raises_not_found(self, client: MemoClaw):
        respx.delete(f"{BASE_URL}/v1/memories/nonexistent").mock(
            return_value=httpx.Response(
                404,
                json={"error": {"code": "NOT_FOUND", "message": "Memory not found"}},
            )
        )
        with pytest.raises(NotFoundError) as exc_info:
            client.delete("nonexistent")
        assert exc_info.value.status_code == 404
        assert exc_info.value.code == "NOT_FOUND"

    @respx.mock
    def test_422_raises_validation(self, client: MemoClaw):
        respx.post(f"{BASE_URL}/v1/store").mock(
            return_value=httpx.Response(
                422,
                json={
                    "error": {
                        "code": "VALIDATION_ERROR",
                        "message": "Content too long",
                    }
                },
            )
        )
        with pytest.raises(ValidationError) as exc_info:
            client.store("x" * 10000)
        assert exc_info.value.status_code == 422


class TestPayment402:
    @respx.mock
    def test_402_without_x402_raises(self, client: MemoClaw):
        """When x402 is not available, 402 should raise PaymentRequiredError."""
        respx.post(f"{BASE_URL}/v1/store").mock(
            return_value=httpx.Response(
                402,
                json={
                    "error": {
                        "code": "PAYMENT_REQUIRED",
                        "message": "Free tier exhausted",
                    }
                },
            )
        )
        from memoclaw.errors import PaymentRequiredError

        # Patch x402 import to fail
        with patch("memoclaw._client._try_x402_payment", return_value=None):
            with pytest.raises(PaymentRequiredError):
                client.store("test")

    @respx.mock
    def test_402_with_x402_retries(self, client: MemoClaw):
        """When x402 provides payment headers, the request should be retried."""
        # First call returns 402, second succeeds
        route = respx.post(f"{BASE_URL}/v1/store").mock(
            side_effect=[
                httpx.Response(
                    402,
                    json={
                        "error": {
                            "code": "PAYMENT_REQUIRED",
                            "message": "Free tier exhausted",
                        }
                    },
                ),
                httpx.Response(
                    201,
                    json={
                        "id": "mem-paid",
                        "stored": True,
                        "deduplicated": False,
                        "tokens_used": 42,
                    },
                ),
            ]
        )
        with patch(
            "memoclaw._client._try_x402_payment",
            return_value={"x-payment": "paid-token"},
        ):
            result = client.store("test")
            assert result.id == "mem-paid"
            assert route.call_count == 2


class TestEnvVar:
    def test_env_var_fallback(self, monkeypatch):
        monkeypatch.setenv("MEMOCLAW_PRIVATE_KEY", TEST_PRIVATE_KEY)
        c = MemoClaw()
        c.close()

    def test_missing_key_raises(self, monkeypatch):
        monkeypatch.delenv("MEMOCLAW_PRIVATE_KEY", raising=False)
        with pytest.raises(ValueError, match="No private key"):
            MemoClaw()


class TestContextManager:
    @respx.mock
    def test_sync_context_manager(self):
        respx.get(f"{BASE_URL}/v1/free-tier/status").mock(
            return_value=httpx.Response(
                200,
                json={
                    "wallet": "0xabc",
                    "free_tier_remaining": 1000,
                    "free_tier_total": 1000,
                    "free_tier_used": 0,
                },
            )
        )
        with MemoClaw(private_key=TEST_PRIVATE_KEY) as c:
            result = c.status()
            assert result.free_tier_remaining == 1000


class TestAsyncClient:
    @respx.mock
    @pytest.mark.asyncio
    async def test_async_store(self, async_client: AsyncMemoClaw):
        respx.post(f"{BASE_URL}/v1/store").mock(
            return_value=httpx.Response(
                201,
                json={
                    "id": "async-123",
                    "stored": True,
                    "deduplicated": False,
                    "tokens_used": 42,
                },
            )
        )
        result = await async_client.store("Async test", importance=0.5)
        assert result.id == "async-123"
        await async_client.close()

    @respx.mock
    @pytest.mark.asyncio
    async def test_async_context_manager(self):
        respx.get(f"{BASE_URL}/v1/free-tier/status").mock(
            return_value=httpx.Response(
                200,
                json={
                    "wallet": "0xabc",
                    "free_tier_remaining": 1000,
                    "free_tier_total": 1000,
                    "free_tier_used": 0,
                },
            )
        )
        async with AsyncMemoClaw(private_key=TEST_PRIVATE_KEY) as c:
            result = await c.status()
            assert result.free_tier_remaining == 1000
