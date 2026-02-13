"""Tests for new features: delete_batch, search alias, get() hooks, pinned field."""

from __future__ import annotations

import httpx
import pytest
import respx

from memoclaw import AsyncMemoClaw, MemoClaw, Memory

TEST_PRIVATE_KEY = "0x4c0883a69102937d6231471b5dbb6204fe512961708279f15a8f7e20b4e3b1fb"
BASE_URL = "https://api.memoclaw.com"

_MEMORY_JSON = {
    "id": "mem-123",
    "user_id": "u1",
    "namespace": "default",
    "content": "Test",
    "embedding_model": "text-embedding-3-small",
    "metadata": {},
    "importance": 0.5,
    "memory_type": "general",
    "session_id": None,
    "agent_id": None,
    "created_at": "2025-01-01T00:00:00Z",
    "updated_at": "2025-01-01T00:00:00Z",
    "accessed_at": "2025-01-01T00:00:00Z",
    "access_count": 1,
    "deleted_at": None,
    "expires_at": None,
    "pinned": True,
}


@pytest.fixture
def client():
    c = MemoClaw(private_key=TEST_PRIVATE_KEY, base_url=BASE_URL)
    yield c
    c.close()


@pytest.fixture
def async_client():
    return AsyncMemoClaw(private_key=TEST_PRIVATE_KEY, base_url=BASE_URL)


class TestGetUsesHooks:
    """Bug fix: get() should invoke middleware hooks."""

    @respx.mock
    def test_get_triggers_before_hook(self, client: MemoClaw):
        respx.get(f"{BASE_URL}/v1/memories/mem-123").mock(
            return_value=httpx.Response(200, json=_MEMORY_JSON)
        )
        calls = []
        client.on_before_request(lambda m, p, b: calls.append((m, p)))
        client.get("mem-123")
        assert ("GET", "/v1/memories/mem-123") in calls

    @respx.mock
    def test_get_triggers_after_hook(self, client: MemoClaw):
        respx.get(f"{BASE_URL}/v1/memories/mem-123").mock(
            return_value=httpx.Response(200, json=_MEMORY_JSON)
        )
        calls = []
        client.on_after_response(lambda m, p, d: calls.append(p))
        client.get("mem-123")
        assert "/v1/memories/mem-123" in calls

    @respx.mock
    @pytest.mark.asyncio
    async def test_async_get_triggers_hooks(self, async_client: AsyncMemoClaw):
        respx.get(f"{BASE_URL}/v1/memories/mem-123").mock(
            return_value=httpx.Response(200, json=_MEMORY_JSON)
        )
        calls = []
        async_client.on_before_request(lambda m, p, b: calls.append(p))
        await async_client.get("mem-123")
        assert "/v1/memories/mem-123" in calls
        await async_client.close()


class TestPinnedField:
    """Memory model should include the pinned field."""

    def test_pinned_true(self):
        mem = Memory.model_validate(_MEMORY_JSON)
        assert mem.pinned is True

    def test_pinned_default_false(self):
        data = {**_MEMORY_JSON, "pinned": False}
        mem = Memory.model_validate(data)
        assert mem.pinned is False

    def test_pinned_missing_defaults_false(self):
        data = {k: v for k, v in _MEMORY_JSON.items() if k != "pinned"}
        mem = Memory.model_validate(data)
        assert mem.pinned is False


class TestDeleteBatch:
    @respx.mock
    def test_delete_batch(self, client: MemoClaw):
        for mid in ["m1", "m2", "m3"]:
            respx.delete(f"{BASE_URL}/v1/memories/{mid}").mock(
                return_value=httpx.Response(200, json={"deleted": True, "id": mid})
            )
        results = client.delete_batch(["m1", "m2", "m3"])
        assert len(results) == 3
        assert all(r.deleted for r in results)

    @respx.mock
    @pytest.mark.asyncio
    async def test_async_delete_batch(self, async_client: AsyncMemoClaw):
        for mid in ["m1", "m2"]:
            respx.delete(f"{BASE_URL}/v1/memories/{mid}").mock(
                return_value=httpx.Response(200, json={"deleted": True, "id": mid})
            )
        results = await async_client.delete_batch(["m1", "m2"])
        assert len(results) == 2
        await async_client.close()


class TestSearchAlias:
    @respx.mock
    def test_search_is_recall(self, client: MemoClaw):
        respx.post(f"{BASE_URL}/v1/recall").mock(
            return_value=httpx.Response(
                200, json={"memories": [], "query_tokens": 3}
            )
        )
        result = client.search("test query")
        assert result.query_tokens == 3

    @respx.mock
    @pytest.mark.asyncio
    async def test_async_search_is_recall(self, async_client: AsyncMemoClaw):
        respx.post(f"{BASE_URL}/v1/recall").mock(
            return_value=httpx.Response(
                200, json={"memories": [], "query_tokens": 3}
            )
        )
        result = await async_client.search("test query")
        assert result.query_tokens == 3
        await async_client.close()


class TestListAllAlias:
    @respx.mock
    def test_list_all_is_iter_memories(self, client: MemoClaw):
        """list_all should be an alias for iter_memories."""
        assert client.list_all == client.iter_memories
