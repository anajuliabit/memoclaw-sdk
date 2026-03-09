"""Tests for the async LlamaIndex integration module."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

# Skip all tests if llama-index-core is not installed
llama_index_core = pytest.importorskip("llama_index.core")

from llama_index.core.schema import NodeWithScore, TextNode

from memoclaw.integrations.llamaindex import (
    AsyncMemoClawMemoryStore,
    AsyncMemoClawRetriever,
)
from memoclaw.types import RecallMemory, RecallResponse


# ── Fixtures ─────────────────────────────────────────────────────────────────


def _make_recall_memory(
    id: str = "mem-1",
    content: str = "Hello",
    similarity: float = 0.95,
    metadata: dict[str, Any] | None = None,
    namespace: str = "default",
    session_id: str | None = None,
    agent_id: str | None = None,
) -> RecallMemory:
    return RecallMemory(
        id=id,
        content=content,
        similarity=similarity,
        metadata=metadata or {},
        importance=0.8,
        memory_type="preference",
        namespace=namespace,
        session_id=session_id,
        agent_id=agent_id,
        created_at="2026-01-01T00:00:00Z",
        access_count=5,
        pinned=False,
        immutable=False,
    )


@pytest.fixture
def mock_client() -> AsyncMock:
    """Create a mock AsyncMemoClaw client."""
    return AsyncMock()


# ── Async Retriever tests ───────────────────────────────────────────────────


class TestAsyncMemoClawRetriever:
    @pytest.mark.asyncio
    async def test_basic_retrieval(self, mock_client: AsyncMock):
        mock_client.recall.return_value = RecallResponse(
            memories=[
                _make_recall_memory(
                    id="mem-1",
                    content="User prefers dark mode",
                    similarity=0.95,
                    metadata={"tags": ["preferences"]},
                ),
                _make_recall_memory(
                    id="mem-2",
                    content="User is a Python developer",
                    similarity=0.82,
                ),
            ],
            query_tokens=10,
        )
        retriever = AsyncMemoClawRetriever(client=mock_client)
        nodes = await retriever.aretrieve("user preferences")

        assert len(nodes) == 2
        assert isinstance(nodes[0], NodeWithScore)
        assert nodes[0].text == "User prefers dark mode"
        assert nodes[0].score == 0.95
        assert nodes[0].node.metadata["id"] == "mem-1"

    @pytest.mark.asyncio
    async def test_retrieval_with_all_filters(self, mock_client: AsyncMock):
        mock_client.recall.return_value = RecallResponse(
            memories=[], query_tokens=5
        )
        retriever = AsyncMemoClawRetriever(
            client=mock_client,
            namespace="ns",
            tags=["important"],
            top_k=3,
            min_similarity=0.5,
            session_id="sess-1",
            agent_id="agent-1",
            include_relations=True,
        )
        await retriever.aretrieve("query")

        mock_client.recall.assert_awaited_once_with(
            "query",
            limit=3,
            namespace="ns",
            tags=["important"],
            min_similarity=0.5,
            session_id="sess-1",
            agent_id="agent-1",
            include_relations=True,
        )

    @pytest.mark.asyncio
    async def test_retrieval_empty(self, mock_client: AsyncMock):
        mock_client.recall.return_value = RecallResponse(
            memories=[], query_tokens=5
        )
        retriever = AsyncMemoClawRetriever(client=mock_client)
        nodes = await retriever.aretrieve("no results")
        assert nodes == []

    @pytest.mark.asyncio
    async def test_metadata_includes_session_and_agent(self, mock_client: AsyncMock):
        mock_client.recall.return_value = RecallResponse(
            memories=[
                _make_recall_memory(
                    id="mem-1",
                    content="test",
                    session_id="sess-42",
                    agent_id="agent-7",
                ),
            ],
            query_tokens=5,
        )
        retriever = AsyncMemoClawRetriever(client=mock_client)
        nodes = await retriever.aretrieve("test")
        assert nodes[0].node.metadata["session_id"] == "sess-42"
        assert nodes[0].node.metadata["agent_id"] == "agent-7"

    @pytest.mark.asyncio
    async def test_node_id_matches_memory_id(self, mock_client: AsyncMock):
        mock_client.recall.return_value = RecallResponse(
            memories=[_make_recall_memory(id="mem-abc", content="test")],
            query_tokens=5,
        )
        retriever = AsyncMemoClawRetriever(client=mock_client)
        nodes = await retriever.aretrieve("test")
        assert nodes[0].node.id_ == "mem-abc"

    def test_sync_retrieve_raises(self, mock_client: AsyncMock):
        retriever = AsyncMemoClawRetriever(client=mock_client)
        with pytest.raises(NotImplementedError):
            retriever.retrieve("test")


# ── Async Memory Store tests ────────────────────────────────────────────────


class TestAsyncMemoClawMemoryStore:
    @pytest.mark.asyncio
    async def test_put_basic(self, mock_client: AsyncMock):
        mock_client.store.return_value = MagicMock()
        store = AsyncMemoClawMemoryStore(client=mock_client)
        await store.put("User prefers dark mode")
        mock_client.store.assert_awaited_once_with("User prefers dark mode")

    @pytest.mark.asyncio
    async def test_put_with_all_options(self, mock_client: AsyncMock):
        mock_client.store.return_value = MagicMock()
        store = AsyncMemoClawMemoryStore(client=mock_client, namespace="default-ns")
        await store.put(
            "test content",
            tags=["pref"],
            importance=0.9,
            namespace="override-ns",
            session_id="sess-1",
            agent_id="agent-1",
            metadata={"key": "val"},
        )
        mock_client.store.assert_awaited_once_with(
            "test content",
            tags=["pref"],
            importance=0.9,
            metadata={"key": "val"},
            namespace="override-ns",
            session_id="sess-1",
            agent_id="agent-1",
        )

    @pytest.mark.asyncio
    async def test_put_inherits_defaults(self, mock_client: AsyncMock):
        mock_client.store.return_value = MagicMock()
        store = AsyncMemoClawMemoryStore(
            client=mock_client,
            namespace="my-ns",
            agent_id="agent-default",
            session_id="sess-default",
        )
        await store.put("content")
        mock_client.store.assert_awaited_once_with(
            "content",
            namespace="my-ns",
            session_id="sess-default",
            agent_id="agent-default",
        )

    @pytest.mark.asyncio
    async def test_put_batch(self, mock_client: AsyncMock):
        mock_client.store_batch.return_value = MagicMock()
        store = AsyncMemoClawMemoryStore(client=mock_client, namespace="ns")
        await store.put_batch([
            {"content": "Memory 1"},
            {"content": "Memory 2", "namespace": "other"},
        ])
        mock_client.store_batch.assert_awaited_once()
        items = mock_client.store_batch.call_args[0][0]
        assert len(items) == 2
        assert items[0]["namespace"] == "ns"
        assert items[1]["namespace"] == "other"

    @pytest.mark.asyncio
    async def test_search_returns_nodes(self, mock_client: AsyncMock):
        mock_client.recall.return_value = RecallResponse(
            memories=[
                _make_recall_memory(
                    id="mem-1",
                    content="User prefers dark mode",
                    similarity=0.95,
                ),
            ],
            query_tokens=10,
        )
        store = AsyncMemoClawMemoryStore(client=mock_client)
        nodes = await store.search("preferences")
        assert len(nodes) == 1
        assert isinstance(nodes[0], NodeWithScore)
        assert nodes[0].text == "User prefers dark mode"
        assert nodes[0].score == 0.95

    @pytest.mark.asyncio
    async def test_search_with_filters(self, mock_client: AsyncMock):
        mock_client.recall.return_value = RecallResponse(
            memories=[], query_tokens=5
        )
        store = AsyncMemoClawMemoryStore(client=mock_client, namespace="ns")
        await store.search("query", top_k=10, tags=["important"], min_similarity=0.7)
        mock_client.recall.assert_awaited_once_with(
            "query",
            limit=10,
            namespace="ns",
            tags=["important"],
            min_similarity=0.7,
        )

    @pytest.mark.asyncio
    async def test_search_namespace_override(self, mock_client: AsyncMock):
        mock_client.recall.return_value = RecallResponse(
            memories=[], query_tokens=5
        )
        store = AsyncMemoClawMemoryStore(client=mock_client, namespace="default-ns")
        await store.search("query", namespace="override-ns")
        call_kwargs = mock_client.recall.call_args[1]
        assert call_kwargs["namespace"] == "override-ns"

    @pytest.mark.asyncio
    async def test_delete(self, mock_client: AsyncMock):
        mock_client.delete.return_value = MagicMock()
        store = AsyncMemoClawMemoryStore(client=mock_client)
        await store.delete("mem-1")
        mock_client.delete.assert_awaited_once_with("mem-1")

    @pytest.mark.asyncio
    async def test_delete_batch(self, mock_client: AsyncMock):
        mock_client.delete_batch.return_value = []
        store = AsyncMemoClawMemoryStore(client=mock_client)
        await store.delete_batch(["mem-1", "mem-2"])
        mock_client.delete_batch.assert_awaited_once_with(["mem-1", "mem-2"])

    @pytest.mark.asyncio
    async def test_as_retriever(self, mock_client: AsyncMock):
        store = AsyncMemoClawMemoryStore(
            client=mock_client,
            namespace="ns",
            session_id="sess-1",
            agent_id="agent-1",
        )
        retriever = store.as_retriever(
            top_k=10,
            tags=["important"],
            min_similarity=0.7,
            include_relations=True,
        )
        assert isinstance(retriever, AsyncMemoClawRetriever)
        assert retriever._namespace == "ns"
        assert retriever._session_id == "sess-1"
        assert retriever._agent_id == "agent-1"
        assert retriever._top_k == 10
        assert retriever._tags == ["important"]
        assert retriever._min_similarity == 0.7
        assert retriever._include_relations is True

    @pytest.mark.asyncio
    async def test_as_retriever_defaults(self, mock_client: AsyncMock):
        store = AsyncMemoClawMemoryStore(client=mock_client)
        retriever = store.as_retriever()
        assert isinstance(retriever, AsyncMemoClawRetriever)
        assert retriever._namespace is None
        assert retriever._top_k == 5


# ── Module exports test ──────────────────────────────────────────────────────


class TestModuleExports:
    def test_module_exports_async_classes(self):
        import memoclaw.integrations.llamaindex as mod
        assert hasattr(mod, "AsyncMemoClawRetriever")
        assert hasattr(mod, "AsyncMemoClawMemoryStore")
