"""Tests for list_all pagination iterator."""

from __future__ import annotations

import httpx
import pytest
import respx

from memoclaw import MemoClaw, AsyncMemoClaw

TEST_PRIVATE_KEY = "0x4c0883a69102937d6231471b5dbb6204fe512961708279f15a8f7e20b4e3b1fb"
BASE_URL = "https://api.memoclaw.com"

MEMORY_TEMPLATE = {
    "user_id": "u1",
    "namespace": "default",
    "embedding_model": "text-embedding-3-small",
    "metadata": {},
    "importance": 0.5,
    "memory_type": "general",
    "session_id": None,
    "agent_id": None,
    "created_at": "2025-01-01T00:00:00Z",
    "updated_at": "2025-01-01T00:00:00Z",
    "accessed_at": "2025-01-01T00:00:00Z",
    "access_count": 0,
    "deleted_at": None,
    "expires_at": None,
    "pinned": False,
}


def _make_memory(i: int) -> dict:
    return {**MEMORY_TEMPLATE, "id": f"m{i}", "content": f"Memory {i}"}


@pytest.fixture
def client():
    c = MemoClaw(private_key=TEST_PRIVATE_KEY, base_url=BASE_URL)
    yield c
    c.close()


class TestListAll:
    @respx.mock
    def test_single_page(self, client: MemoClaw):
        respx.get(f"{BASE_URL}/v1/memories").mock(
            return_value=httpx.Response(
                200,
                json={
                    "memories": [_make_memory(1), _make_memory(2)],
                    "total": 2,
                    "limit": 50,
                    "offset": 0,
                },
            )
        )
        memories = list(client.list_all())
        assert len(memories) == 2
        assert memories[0].id == "m1"

    @respx.mock
    def test_multiple_pages(self, client: MemoClaw):
        route = respx.get(f"{BASE_URL}/v1/memories").mock(
            side_effect=[
                httpx.Response(
                    200,
                    json={
                        "memories": [_make_memory(1), _make_memory(2)],
                        "total": 3,
                        "limit": 2,
                        "offset": 0,
                    },
                ),
                httpx.Response(
                    200,
                    json={
                        "memories": [_make_memory(3)],
                        "total": 3,
                        "limit": 2,
                        "offset": 2,
                    },
                ),
            ]
        )
        memories = list(client.list_all(batch_size=2))
        assert len(memories) == 3
        assert route.call_count == 2

    @respx.mock
    def test_empty_result(self, client: MemoClaw):
        respx.get(f"{BASE_URL}/v1/memories").mock(
            return_value=httpx.Response(
                200,
                json={"memories": [], "total": 0, "limit": 50, "offset": 0},
            )
        )
        memories = list(client.list_all())
        assert len(memories) == 0


class TestAsyncListAll:
    @respx.mock
    @pytest.mark.asyncio
    async def test_async_pagination(self):
        respx.get(f"{BASE_URL}/v1/memories").mock(
            side_effect=[
                httpx.Response(
                    200,
                    json={
                        "memories": [_make_memory(1)],
                        "total": 2,
                        "limit": 1,
                        "offset": 0,
                    },
                ),
                httpx.Response(
                    200,
                    json={
                        "memories": [_make_memory(2)],
                        "total": 2,
                        "limit": 1,
                        "offset": 1,
                    },
                ),
            ]
        )
        async with AsyncMemoClaw(private_key=TEST_PRIVATE_KEY) as client:
            memories = []
            async for mem in client.list_all(batch_size=1):
                memories.append(mem)
            assert len(memories) == 2
