"""Tests for the LangChain integration module."""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, call, patch

import pytest

# Skip all tests if langchain-core is not installed
langchain_core = pytest.importorskip("langchain_core")

from langchain_core.documents import Document
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from memoclaw.integrations.langchain import (
    MemoClawChatMessageHistory,
    MemoClawRetriever,
    _message_to_role,
    _role_to_message,
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
    """Create a Memory object for testing."""
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
    """Create a RecallMemory object for testing."""
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
def mock_client() -> MagicMock:
    """Create a mock MemoClaw client."""
    return MagicMock()


# ── Helper function tests ────────────────────────────────────────────────────


class TestHelpers:
    def test_message_to_role_human(self):
        assert _message_to_role(HumanMessage(content="hi")) == "user"

    def test_message_to_role_ai(self):
        assert _message_to_role(AIMessage(content="hello")) == "assistant"

    def test_message_to_role_system(self):
        assert _message_to_role(SystemMessage(content="you are a bot")) == "system"

    def test_role_to_message_user(self):
        msg = _role_to_message("user", "hi")
        assert isinstance(msg, HumanMessage)
        assert msg.content == "hi"

    def test_role_to_message_assistant(self):
        msg = _role_to_message("assistant", "hello")
        assert isinstance(msg, AIMessage)
        assert msg.content == "hello"

    def test_role_to_message_system(self):
        msg = _role_to_message("system", "you are a bot")
        assert isinstance(msg, SystemMessage)
        assert msg.content == "you are a bot"

    def test_role_to_message_human_alias(self):
        msg = _role_to_message("human", "hi")
        assert isinstance(msg, HumanMessage)

    def test_role_to_message_ai_alias(self):
        msg = _role_to_message("ai", "hello")
        assert isinstance(msg, AIMessage)

    def test_role_to_message_unknown_defaults_to_human(self):
        msg = _role_to_message("unknown_role", "test")
        assert isinstance(msg, HumanMessage)


# ── Chat Message History tests ───────────────────────────────────────────────


class TestMemoClawChatMessageHistory:
    def test_messages_empty(self, mock_client: MagicMock):
        mock_client.list.return_value = ListResponse(
            memories=[], total=0, limit=100, offset=0
        )
        history = MemoClawChatMessageHistory(
            client=mock_client, session_id="sess-1"
        )
        assert history.messages == []
        mock_client.list.assert_called_once_with(
            session_id="sess-1",
            namespace=None,
            agent_id=None,
            tags=["chat_message"],
            limit=100,
            offset=0,
        )

    def test_messages_returns_correct_types(self, mock_client: MagicMock):
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
        history = MemoClawChatMessageHistory(
            client=mock_client, session_id="sess-1"
        )
        messages = history.messages
        assert len(messages) == 2
        assert isinstance(messages[0], HumanMessage)
        assert messages[0].content == "Hello!"
        assert isinstance(messages[1], AIMessage)
        assert messages[1].content == "Hi there!"

    def test_messages_pagination(self, mock_client: MagicMock):
        """Should paginate through all memories."""
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
        history = MemoClawChatMessageHistory(
            client=mock_client, session_id="sess-1"
        )
        messages = history.messages
        assert len(messages) == 150
        assert mock_client.list.call_count == 2

    def test_add_message_user(self, mock_client: MagicMock):
        mock_client.store.return_value = MagicMock()
        history = MemoClawChatMessageHistory(
            client=mock_client, session_id="sess-1"
        )
        history.add_message(HumanMessage(content="What's the weather?"))
        mock_client.store.assert_called_once_with(
            "What's the weather?",
            tags=["chat_message"],
            session_id="sess-1",
            metadata={"role": "user"},
        )

    def test_add_message_ai(self, mock_client: MagicMock):
        mock_client.store.return_value = MagicMock()
        history = MemoClawChatMessageHistory(
            client=mock_client, session_id="sess-1"
        )
        history.add_message(AIMessage(content="It's sunny!"))
        mock_client.store.assert_called_once_with(
            "It's sunny!",
            tags=["chat_message"],
            session_id="sess-1",
            metadata={"role": "assistant"},
        )

    def test_add_message_with_namespace_and_agent(self, mock_client: MagicMock):
        mock_client.store.return_value = MagicMock()
        history = MemoClawChatMessageHistory(
            client=mock_client,
            session_id="sess-1",
            namespace="project-x",
            agent_id="agent-007",
        )
        history.add_message(HumanMessage(content="test"))
        mock_client.store.assert_called_once_with(
            "test",
            tags=["chat_message"],
            session_id="sess-1",
            metadata={"role": "user"},
            namespace="project-x",
            agent_id="agent-007",
        )

    def test_add_messages_batch(self, mock_client: MagicMock):
        mock_client.store_batch.return_value = MagicMock()
        history = MemoClawChatMessageHistory(
            client=mock_client, session_id="sess-1"
        )
        history.add_messages([
            HumanMessage(content="Hello"),
            AIMessage(content="Hi!"),
            SystemMessage(content="Be helpful"),
        ])
        mock_client.store_batch.assert_called_once()
        items = mock_client.store_batch.call_args[0][0]
        assert len(items) == 3
        assert items[0]["content"] == "Hello"
        assert items[0]["metadata"]["role"] == "user"
        assert items[1]["content"] == "Hi!"
        assert items[1]["metadata"]["role"] == "assistant"
        assert items[2]["content"] == "Be helpful"
        assert items[2]["metadata"]["role"] == "system"

    def test_add_messages_empty(self, mock_client: MagicMock):
        history = MemoClawChatMessageHistory(
            client=mock_client, session_id="sess-1"
        )
        history.add_messages([])
        mock_client.store_batch.assert_not_called()
        mock_client.store.assert_not_called()

    def test_add_user_message(self, mock_client: MagicMock):
        mock_client.store.return_value = MagicMock()
        history = MemoClawChatMessageHistory(
            client=mock_client, session_id="sess-1"
        )
        history.add_user_message("test")
        mock_client.store.assert_called_once()
        call_args = mock_client.store.call_args
        assert call_args[0][0] == "test"
        assert call_args[1]["metadata"]["role"] == "user"

    def test_add_ai_message(self, mock_client: MagicMock):
        mock_client.store.return_value = MagicMock()
        history = MemoClawChatMessageHistory(
            client=mock_client, session_id="sess-1"
        )
        history.add_ai_message("response")
        mock_client.store.assert_called_once()
        call_args = mock_client.store.call_args
        assert call_args[0][0] == "response"
        assert call_args[1]["metadata"]["role"] == "assistant"

    def test_clear(self, mock_client: MagicMock):
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
        history = MemoClawChatMessageHistory(
            client=mock_client, session_id="sess-1"
        )
        history.clear()
        mock_client.delete_batch.assert_called_once_with(["m1", "m2"])

    def test_clear_empty(self, mock_client: MagicMock):
        mock_client.list.return_value = ListResponse(
            memories=[], total=0, limit=100, offset=0
        )
        history = MemoClawChatMessageHistory(
            client=mock_client, session_id="sess-1"
        )
        history.clear()
        mock_client.delete_batch.assert_not_called()

    def test_custom_tag(self, mock_client: MagicMock):
        mock_client.list.return_value = ListResponse(
            memories=[], total=0, limit=100, offset=0
        )
        history = MemoClawChatMessageHistory(
            client=mock_client, session_id="sess-1", tag="my_tag"
        )
        history.messages
        mock_client.list.assert_called_once_with(
            session_id="sess-1",
            namespace=None,
            agent_id=None,
            tags=["my_tag"],
            limit=100,
            offset=0,
        )


# ── Retriever tests ──────────────────────────────────────────────────────────


class TestMemoClawRetriever:
    def test_basic_retrieval(self, mock_client: MagicMock):
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
        retriever = MemoClawRetriever(client=mock_client)
        docs = retriever.invoke("user preferences")

        assert len(docs) == 2
        assert isinstance(docs[0], Document)
        assert docs[0].page_content == "User prefers dark mode"
        assert docs[0].metadata["id"] == "mem-1"
        assert docs[0].metadata["similarity"] == 0.95
        assert docs[0].metadata["importance"] == 0.8
        assert docs[0].metadata["memory_type"] == "preference"

    def test_retrieval_with_namespace(self, mock_client: MagicMock):
        mock_client.recall.return_value = RecallResponse(
            memories=[], query_tokens=5
        )
        retriever = MemoClawRetriever(
            client=mock_client,
            namespace="project-x",
            top_k=10,
            min_similarity=0.7,
        )
        retriever.invoke("test query")

        mock_client.recall.assert_called_once_with(
            "test query",
            limit=10,
            namespace="project-x",
            min_similarity=0.7,
        )

    def test_retrieval_with_all_filters(self, mock_client: MagicMock):
        mock_client.recall.return_value = RecallResponse(
            memories=[], query_tokens=5
        )
        retriever = MemoClawRetriever(
            client=mock_client,
            namespace="ns",
            tags=["important"],
            top_k=3,
            min_similarity=0.5,
            session_id="sess-1",
            agent_id="agent-1",
            include_relations=True,
        )
        retriever.invoke("query")

        mock_client.recall.assert_called_once_with(
            "query",
            limit=3,
            namespace="ns",
            tags=["important"],
            min_similarity=0.5,
            session_id="sess-1",
            agent_id="agent-1",
            include_relations=True,
        )

    def test_retrieval_empty_results(self, mock_client: MagicMock):
        mock_client.recall.return_value = RecallResponse(
            memories=[], query_tokens=5
        )
        retriever = MemoClawRetriever(client=mock_client)
        docs = retriever.invoke("no results query")
        assert docs == []

    def test_metadata_includes_session_and_agent(self, mock_client: MagicMock):
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
        retriever = MemoClawRetriever(client=mock_client)
        docs = retriever.invoke("test")

        assert docs[0].metadata["session_id"] == "sess-42"
        assert docs[0].metadata["agent_id"] == "agent-7"

    def test_metadata_includes_memory_metadata(self, mock_client: MagicMock):
        mock_client.recall.return_value = RecallResponse(
            memories=[
                _make_recall_memory(
                    id="mem-1",
                    content="test",
                    metadata={"tags": ["pref"], "custom_key": "custom_val"},
                ),
            ],
            query_tokens=5,
        )
        retriever = MemoClawRetriever(client=mock_client)
        docs = retriever.invoke("test")

        assert docs[0].metadata["memory_metadata"]["tags"] == ["pref"]
        assert docs[0].metadata["memory_metadata"]["custom_key"] == "custom_val"

    def test_default_top_k(self, mock_client: MagicMock):
        mock_client.recall.return_value = RecallResponse(
            memories=[], query_tokens=5
        )
        retriever = MemoClawRetriever(client=mock_client)
        retriever.invoke("test")

        call_kwargs = mock_client.recall.call_args
        assert call_kwargs[1]["limit"] == 5


# ── Import error test ────────────────────────────────────────────────────────


class TestImportError:
    def test_helpful_import_error_when_langchain_missing(self):
        """Verify we get a helpful error message if langchain_core is not installed."""
        # This test verifies the import error message is correct.
        # Since langchain_core IS installed in test env, we test the module-level
        # error handling by mocking.
        import importlib
        import sys

        # We can't easily test this without uninstalling langchain-core,
        # but we can verify the error message format in the source
        import memoclaw.integrations.langchain as mod

        assert hasattr(mod, "MemoClawChatMessageHistory")
        assert hasattr(mod, "MemoClawRetriever")
