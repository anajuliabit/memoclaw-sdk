"""Tests for new endpoints: context, namespaces, stats, export, history."""

from __future__ import annotations

import pytest
import respx
import httpx

from memoclaw import (
    AsyncMemoClaw,
    MemoClaw,
    ContextResult,
    NamespacesResponse,
    StatsResponse,
    ExportResponse,
    HistoryEntry,
)

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


class TestAssembleContext:
    @respx.mock
    def test_basic(self, client):
        respx.post(f"{BASE_URL}/v1/context").mock(
            return_value=httpx.Response(200, json={
                "context": "User prefers dark mode.",
                "memories_used": 3,
                "tokens": 42,
            })
        )
        result = client.assemble_context("user preferences")
        assert isinstance(result, ContextResult)
        assert result.memories_used == 3
        assert result.tokens == 42
        assert "dark mode" in result.context

    @respx.mock
    def test_with_options(self, client):
        respx.post(f"{BASE_URL}/v1/context").mock(
            return_value=httpx.Response(200, json={
                "context": {"memories": []},
                "memories_used": 0,
                "tokens": 0,
            })
        )
        result = client.assemble_context(
            "test",
            namespace="ns",
            max_memories=5,
            max_tokens=2000,
            format="structured",
            include_metadata=True,
            summarize=True,
        )
        assert isinstance(result.context, dict)

    def test_empty_query_raises(self, client):
        with pytest.raises(ValueError, match="query"):
            client.assemble_context("")

    @respx.mock
    @pytest.mark.asyncio
    async def test_async(self, async_client):
        respx.post(f"{BASE_URL}/v1/context").mock(
            return_value=httpx.Response(200, json={
                "context": "test context",
                "memories_used": 1,
                "tokens": 10,
            })
        )
        result = await async_client.assemble_context("test query")
        assert result.memories_used == 1


class TestListNamespaces:
    @respx.mock
    def test_basic(self, client):
        respx.get(f"{BASE_URL}/v1/namespaces").mock(
            return_value=httpx.Response(200, json={
                "namespaces": [
                    {"name": "default", "count": 42, "last_memory_at": "2026-02-13T10:30:00Z"},
                    {"name": "project", "count": 10, "last_memory_at": None},
                ],
                "total": 2,
            })
        )
        result = client.list_namespaces()
        assert isinstance(result, NamespacesResponse)
        assert result.total == 2
        assert result.namespaces[0].name == "default"
        assert result.namespaces[0].count == 42

    @respx.mock
    @pytest.mark.asyncio
    async def test_async(self, async_client):
        respx.get(f"{BASE_URL}/v1/namespaces").mock(
            return_value=httpx.Response(200, json={
                "namespaces": [],
                "total": 0,
            })
        )
        result = await async_client.list_namespaces()
        assert result.total == 0


class TestStats:
    @respx.mock
    def test_basic(self, client):
        respx.get(f"{BASE_URL}/v1/stats").mock(
            return_value=httpx.Response(200, json={
                "total_memories": 142,
                "pinned_count": 8,
                "never_accessed": 23,
                "total_accesses": 891,
                "avg_importance": 0.64,
                "oldest_memory": "2025-06-01T08:00:00Z",
                "newest_memory": "2026-02-13T10:30:00Z",
                "by_type": [
                    {"memory_type": "preference", "count": 45},
                    {"memory_type": "general", "count": 38},
                ],
                "by_namespace": [
                    {"namespace": "default", "count": 89},
                ],
            })
        )
        result = client.stats()
        assert isinstance(result, StatsResponse)
        assert result.total_memories == 142
        assert result.pinned_count == 8
        assert len(result.by_type) == 2
        assert result.by_type[0].memory_type == "preference"

    @respx.mock
    @pytest.mark.asyncio
    async def test_async(self, async_client):
        respx.get(f"{BASE_URL}/v1/stats").mock(
            return_value=httpx.Response(200, json={
                "total_memories": 0,
                "pinned_count": 0,
                "never_accessed": 0,
                "total_accesses": 0,
                "avg_importance": 0.0,
                "oldest_memory": None,
                "newest_memory": None,
                "by_type": [],
                "by_namespace": [],
            })
        )
        result = await async_client.stats()
        assert result.total_memories == 0


class TestExport:
    @respx.mock
    def test_basic(self, client):
        respx.get(f"{BASE_URL}/v1/export").mock(
            return_value=httpx.Response(200, json={
                "format": "json",
                "memories": [{"id": "m1", "content": "test"}],
                "count": 1,
            })
        )
        result = client.export()
        assert isinstance(result, ExportResponse)
        assert result.count == 1
        assert result.format == "json"

    @respx.mock
    def test_with_filters(self, client):
        respx.get(f"{BASE_URL}/v1/export").mock(
            return_value=httpx.Response(200, json={
                "format": "csv",
                "memories": [],
                "count": 0,
            })
        )
        result = client.export(
            format="csv",
            namespace="test",
            tags=["a", "b"],
            include_deleted=True,
        )
        assert result.format == "csv"

    @respx.mock
    @pytest.mark.asyncio
    async def test_async(self, async_client):
        respx.get(f"{BASE_URL}/v1/export").mock(
            return_value=httpx.Response(200, json={
                "format": "json",
                "memories": [],
                "count": 0,
            })
        )
        result = await async_client.export()
        assert result.count == 0


class TestGetHistory:
    @respx.mock
    def test_basic(self, client):
        respx.get(f"{BASE_URL}/v1/memories/mem-123/history").mock(
            return_value=httpx.Response(200, json={
                "history": [
                    {
                        "id": "h1",
                        "memory_id": "mem-123",
                        "changes": {"content": "updated content"},
                        "created_at": "2026-02-13T10:30:00Z",
                    },
                ],
            })
        )
        result = client.get_history("mem-123")
        assert len(result) == 1
        assert isinstance(result[0], HistoryEntry)
        assert result[0].changes["content"] == "updated content"

    def test_empty_id_raises(self, client):
        with pytest.raises(ValueError, match="memory_id"):
            client.get_history("")

    @respx.mock
    @pytest.mark.asyncio
    async def test_async(self, async_client):
        respx.get(f"{BASE_URL}/v1/memories/mem-456/history").mock(
            return_value=httpx.Response(200, json={"history": []})
        )
        result = await async_client.get_history("mem-456")
        assert result == []
