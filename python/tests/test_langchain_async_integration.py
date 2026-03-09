"""Tests for the async LangChain integration module."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

# Skip all tests if langchain-core is not installed
langchain_core = pytest.importorskip("langchain_core")

from langchain_core.documents import Document
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from memoclaw.integrations.langchain import (
    AsyncMemoClawChatMessageHistory,
    AsyncMemoClawRetriever,
)
from memoclaw.types import ListResponse, Memory, RecallMemory, RecallResponse


# ── Fixtures ─────────────────────────────────────────────────────────────────


def _make_memory(
    id: str = "mem-1",
    content: str = "Hello",
    metadata: dict[str, Any] | None = None,
    namespace: str = "default",
    session_id: str | None = None,
    agent_id: str | None = None,
) -> Memory:
    return Memory(
        id=id,
        user_id="0x1234",
        namespace=namespace,
        content=content,
        embedding_model="text-embedding-3-small",
        metadata=metadata or {},
        importance=0.5,
        memory_type="general",
        session_id=session_id,
        agent_id=agent_id,
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
        accessed_at="2026-01-01T00:00:00Z",
        access_count=1,
        deleted_at=None,
        expires_at=None,
        pinned=False,
        immutable=False,
    )


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


# ── Async Chat Message History tests ─────────────────────────────────────────


class TestAsyncMemoClawChatMessageHistory:
    @pytest.mark.asyncio
    async def test_aget_messages_empty(self, mock_client: AsyncMock):
        mock_client.list.return_value = ListResponse(
            memories=[], total=0, limit=100, offset=0
        )
        history = AsyncMemoClawChatMessageHistory(
            client=mock_client, session_id="sess-1"
        )
        messages = await history.aget_messages()
        assert messages == []
        mock_client.list.assert_awaited_once_with(
            session_id="sess-1",
            namespace=None,
            agent_id=None,
            tags=["chat_message"],
            limit=100,
            offset=0,
        )

    @pytest.mark.asyncio
    async def test_aget_messages_returns_correct_types(self, mock_client: AsyncMock):
        mock_client.list.return_value = ListResponse(
            memories=[
                _make_memory(
                    id="m1",
                    content="Hello!",
                    metadata={"role": "user", "tags": ["chat_message"]},
                    session_id="sess-1",
                ),
                _make_memory(
                    id="m2",
                    content="Hi there!",
                    metadata={"role": "assistant", "tags": ["chat_message"]},
                    session_id="sess-1",
                ),
            ],
            total=2,
            limit=100,
            offset=0,
        )
        history = AsyncMemoClawChatMessageHistory(
            client=mock_client, session_id="sess-1"
        )
        messages = await history.aget_messages()
        assert len(messages) == 2
        assert isinstance(messages[0], HumanMessage)
        assert messages[0].content == "Hello!"
        assert isinstance(messages[1], AIMessage)
        assert messages[1].content == "Hi there!"

    @pytest.mark.asyncio
    async def test_aget_messages_pagination(self, mock_client: AsyncMock):
        page1 = ListResponse(
            memories=[
                _make_memory(id=f"m{i}", content=f"msg-{i}", metadata={"role": "user"})
                for i in range(100)
            ],
            total=150,
            limit=100,
            offset=0,
        )
        page2 = ListResponse(
            memories=[
                _make_memory(id=f"m{i}", content=f"msg-{i}", metadata={"role": "user"})
                for i in range(100, 150)
            ],
            total=150,
            limit=100,
            offset=100,
        )
        mock_client.list.side_effect = [page1, page2]
        history = AsyncMemoClawChatMessageHistory(
            client=mock_client, session_id="sess-1"
        )
        messages = await history.aget_messages()
        assert len(messages) == 150
        assert mock_client.list.await_count == 2

    @pytest.mark.asyncio
    async def test_aadd_messages_batch(self, mock_client: AsyncMock):
        mock_client.store_batch.return_value = MagicMock()
        history = AsyncMemoClawChatMessageHistory(
            client=mock_client, session_id="sess-1"
        )
        await history.aadd_messages([
            HumanMessage(content="Hello"),
            AIMessage(content="Hi!"),
            SystemMessage(content="Be helpful"),
        ])
        mock_client.store_batch.assert_awaited_once()
        items = mock_client.store_batch.call_args[0][0]
        assert len(items) == 3
        assert items[0]["content"] == "Hello"
        assert items[0]["metadata"]["role"] == "user"
        assert items[1]["content"] == "Hi!"
        assert items[1]["metadata"]["role"] == "assistant"
        assert items[2]["content"] == "Be helpful"
        assert items[2]["metadata"]["role"] == "system"

    @pytest.mark.asyncio
    async def test_aadd_messages_empty(self, mock_client: AsyncMock):
        history = AsyncMemoClawChatMessageHistory(
            client=mock_client, session_id="sess-1"
        )
        await history.aadd_messages([])
        mock_client.store_batch.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_aadd_messages_with_namespace_and_agent(self, mock_client: AsyncMock):
        mock_client.store_batch.return_value = MagicMock()
        history = AsyncMemoClawChatMessageHistory(
            client=mock_client,
            session_id="sess-1",
            namespace="project-x",
            agent_id="agent-007",
        )
        await history.aadd_messages([HumanMessage(content="test")])
        items = mock_client.store_batch.call_args[0][0]
        assert items[0]["namespace"] == "project-x"
        assert items[0]["session_id"] == "sess-1"
        assert items[0]["metadata"]["role"] == "user"

    @pytest.mark.asyncio
    async def test_aclear(self, mock_client: AsyncMock):
        mock_client.list.return_value = ListResponse(
            memories=[
                _make_memory(id="m1", content="msg1", session_id="sess-1"),
                _make_memory(id="m2", content="msg2", session_id="sess-1"),
            ],
            total=2,
            limit=100,
            offset=0,
        )
        mock_client.delete_batch.return_value = []
        history = AsyncMemoClawChatMessageHistory(
            client=mock_client, session_id="sess-1"
        )
        await history.aclear()
        mock_client.delete_batch.assert_awaited_once_with(["m1", "m2"])

    @pytest.mark.asyncio
    async def test_aclear_empty(self, mock_client: AsyncMock):
        mock_client.list.return_value = ListResponse(
            memories=[], total=0, limit=100, offset=0
        )
        history = AsyncMemoClawChatMessageHistory(
            client=mock_client, session_id="sess-1"
        )
        await history.aclear()
        mock_client.delete_batch.assert_not_awaited()

    def test_sync_messages_raises(self, mock_client: AsyncMock):
        history = AsyncMemoClawChatMessageHistory(
            client=mock_client, session_id="sess-1"
        )
        with pytest.raises(NotImplementedError):
            _ = history.messages

    def test_sync_add_messages_raises(self, mock_client: AsyncMock):
        history = AsyncMemoClawChatMessageHistory(
            client=mock_client, session_id="sess-1"
        )
        with pytest.raises(NotImplementedError):
            history.add_messages([HumanMessage(content="test")])

    def test_sync_clear_raises(self, mock_client: AsyncMock):
        history = AsyncMemoClawChatMessageHistory(
            client=mock_client, session_id="sess-1"
        )
        with pytest.raises(NotImplementedError):
            history.clear()

    @pytest.mark.asyncio
    async def test_custom_tag(self, mock_client: AsyncMock):
        mock_client.list.return_value = ListResponse(
            memories=[], total=0, limit=100, offset=0
        )
        history = AsyncMemoClawChatMessageHistory(
            client=mock_client, session_id="sess-1", tag="my_tag"
        )
        await history.aget_messages()
        mock_client.list.assert_awaited_once_with(
            session_id="sess-1",
            namespace=None,
            agent_id=None,
            tags=["my_tag"],
            limit=100,
            offset=0,
        )


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
        docs = await retriever.ainvoke("user preferences")

        assert len(docs) == 2
        assert isinstance(docs[0], Document)
        assert docs[0].page_content == "User prefers dark mode"
        assert docs[0].metadata["id"] == "mem-1"
        assert docs[0].metadata["similarity"] == 0.95
        assert docs[0].metadata["importance"] == 0.8

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
        await retriever.ainvoke("query")

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
        docs = await retriever.ainvoke("nothing here")
        assert docs == []

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
        docs = await retriever.ainvoke("test")
        assert docs[0].metadata["session_id"] == "sess-42"
        assert docs[0].metadata["agent_id"] == "agent-7"

    def test_sync_invoke_raises(self, mock_client: AsyncMock):
        retriever = AsyncMemoClawRetriever(client=mock_client)
        with pytest.raises(NotImplementedError):
            retriever.invoke("test")
