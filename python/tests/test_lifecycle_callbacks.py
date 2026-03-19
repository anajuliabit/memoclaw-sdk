"""Tests for memory lifecycle callbacks."""

from __future__ import annotations

import httpx
import pytest
import respx

from memoclaw import MemoClaw, AsyncMemoClaw

TEST_PRIVATE_KEY = "0x4c0883a69102937d6231471b5dbb6204fe512961708279f15a8f7e20b4e3b1fb"
BASE_URL = "https://api.memoclaw.com"


@pytest.fixture
def client() -> MemoClaw:
    c = MemoClaw(private_key=TEST_PRIVATE_KEY, base_url=BASE_URL)
    yield c
    c.close()


@pytest.fixture
async def async_client() -> AsyncMemoClaw:
    c = AsyncMemoClaw(private_key=TEST_PRIVATE_KEY, base_url=BASE_URL)
    try:
        yield c
    finally:
        await c.close()


class TestSyncLifecycleCallbacks:
    @respx.mock
    def test_on_store_receives_store_result(self, client: MemoClaw) -> None:
        events: list[str] = []
        client.on_store(lambda result: events.append(result.id))

        respx.post(f"{BASE_URL}/v1/store").mock(
            return_value=httpx.Response(
                201,
                json={"id": "mem-1", "stored": True, "deduplicated": False, "tokens_used": 4},
            )
        )

        client.store("testing callbacks")

        assert events == ["mem-1"]

    @respx.mock
    def test_on_recall_receives_query_and_results(self, client: MemoClaw) -> None:
        captured: list[tuple[str, int]] = []
        client.on_recall(lambda query, result: captured.append((query, len(result.memories))))

        respx.post(f"{BASE_URL}/v1/recall").mock(
            return_value=httpx.Response(
                200,
                json={
                    "memories": [
                        {
                            "id": "mem-1",
                            "content": "hello",
                            "similarity": 0.9,
                            "metadata": {},
                            "importance": 0.5,
                            "memory_type": "general",
                            "namespace": "default",
                            "session_id": None,
                            "agent_id": None,
                            "created_at": "2025-01-01",
                            "access_count": 1,
                            "pinned": False,
                            "immutable": False,
                        }
                    ],
                    "query_tokens": 12,
                },
            )
        )

        client.recall("dark mode prefs")

        assert captured == [("dark mode prefs", 1)]

    @respx.mock
    def test_on_delete_invoked_for_single_and_batch(self, client: MemoClaw) -> None:
        events: list[str] = []
        client.on_delete(lambda memory_id, _: events.append(memory_id))

        respx.delete(f"{BASE_URL}/v1/memories/mem-1").mock(
            return_value=httpx.Response(200, json={"deleted": True, "id": "mem-1"})
        )
        respx.post(f"{BASE_URL}/v1/memories/batch-delete").mock(
            return_value=httpx.Response(
                200,
                json={
                    "results": [
                        {"id": "mem-2", "deleted": True},
                        {"id": "mem-3", "deleted": False, "error": "not found"},
                    ]
                },
            )
        )

        client.delete("mem-1")
        client.delete_batch(["mem-2", "mem-3"])

        assert events == ["mem-1", "mem-2", "mem-3"]


class TestAsyncLifecycleCallbacks:
    @respx.mock
    @pytest.mark.asyncio
    async def test_async_store_callback_can_await(self, async_client: AsyncMemoClaw) -> None:
        events: list[str] = []

        async def track(result):
            events.append(result.id)

        async_client.on_store(track)

        respx.post(f"{BASE_URL}/v1/store").mock(
            return_value=httpx.Response(
                201,
                json={"id": "mem-async", "stored": True, "deduplicated": False, "tokens_used": 5},
            )
        )

        await async_client.store("async store")

        assert events == ["mem-async"]

    @respx.mock
    @pytest.mark.asyncio
    async def test_async_delete_batch_triggers_callbacks(self, async_client: AsyncMemoClaw) -> None:
        seen: list[str] = []

        async def track(memory_id, _):
            seen.append(memory_id)

        async_client.on_delete(track)

        respx.post(f"{BASE_URL}/v1/memories/batch-delete").mock(
            return_value=httpx.Response(
                200,
                json={
                    "results": [
                        {"id": "mem-a", "deleted": True},
                        {"id": "mem-b", "deleted": True},
                    ]
                },
            )
        )

        await async_client.delete_batch(["mem-a", "mem-b"])

        assert seen == ["mem-a", "mem-b"]
