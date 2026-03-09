"""LangChain integration for MemoClaw.

Provides:
- ``MemoClawChatMessageHistory``: LangChain-compatible chat message history
  backed by MemoClaw's memory API.
- ``MemoClawRetriever``: LangChain-compatible retriever that performs semantic
  recall over stored memories.
- ``AsyncMemoClawChatMessageHistory``: Async variant using ``AsyncMemoClaw``.
- ``AsyncMemoClawRetriever``: Async variant using ``AsyncMemoClaw``.

Install with::

    pip install memoclaw[langchain]

Example — Chat history::

    from memoclaw import MemoClaw
    from memoclaw.integrations.langchain import MemoClawChatMessageHistory

    client = MemoClaw(private_key="0x...")
    history = MemoClawChatMessageHistory(client=client, session_id="chat-42")
    history.add_user_message("I prefer dark mode")
    history.add_ai_message("Noted! I'll remember that.")
    print(history.messages)

Example — Retriever in a RAG chain::

    from memoclaw import MemoClaw
    from memoclaw.integrations.langchain import MemoClawRetriever

    client = MemoClaw(private_key="0x...")
    retriever = MemoClawRetriever(client=client, namespace="project-x")
    docs = retriever.invoke("user preferences")
"""

from __future__ import annotations

from typing import Any, Sequence

try:
    from langchain_core.callbacks import CallbackManagerForRetrieverRun
    from langchain_core.chat_history import BaseChatMessageHistory
    from langchain_core.documents import Document
    from langchain_core.messages import (
        AIMessage,
        BaseMessage,
        HumanMessage,
        SystemMessage,
    )
    from langchain_core.retrievers import BaseRetriever
except ImportError as exc:
    raise ImportError(
        "LangChain integration requires langchain-core. "
        "Install it with: pip install memoclaw[langchain]"
    ) from exc

from memoclaw.client import AsyncMemoClaw, MemoClaw


# ── Helpers ──────────────────────────────────────────────────────────────────

_ROLE_TO_MESSAGE: dict[str, type[BaseMessage]] = {
    "human": HumanMessage,
    "user": HumanMessage,
    "ai": AIMessage,
    "assistant": AIMessage,
    "system": SystemMessage,
}


def _message_to_role(message: BaseMessage) -> str:
    """Map a LangChain message to a MemoClaw-friendly role string."""
    if isinstance(message, HumanMessage):
        return "user"
    if isinstance(message, AIMessage):
        return "assistant"
    if isinstance(message, SystemMessage):
        return "system"
    return message.type


def _role_to_message(role: str, content: str) -> BaseMessage:
    """Create a LangChain message from a role string and content."""
    cls = _ROLE_TO_MESSAGE.get(role, HumanMessage)
    return cls(content=content)


# ── Chat Message History ─────────────────────────────────────────────────────


class MemoClawChatMessageHistory(BaseChatMessageHistory):
    """LangChain chat message history backed by MemoClaw.

    Stores each message as an individual memory with the tag ``chat_message``.
    Messages are stored via :meth:`~memoclaw.MemoClaw.store` and retrieved
    via :meth:`~memoclaw.MemoClaw.list` (filtered by ``session_id`` and tag).

    Args:
        client: A configured :class:`~memoclaw.MemoClaw` instance.
        session_id: Unique session identifier. Maps to MemoClaw's ``session_id``
            parameter for scoping messages to a conversation.
        namespace: Optional MemoClaw namespace for isolation.
        agent_id: Optional agent identifier.
        tag: Tag used to identify chat messages (default: ``"chat_message"``).
    """

    def __init__(
        self,
        client: MemoClaw,
        session_id: str,
        *,
        namespace: str | None = None,
        agent_id: str | None = None,
        tag: str = "chat_message",
    ) -> None:
        self._client = client
        self._session_id = session_id
        self._namespace = namespace
        self._agent_id = agent_id
        self._tag = tag

    @property
    def messages(self) -> list[BaseMessage]:  # type: ignore[override]
        """Retrieve all messages for this session from MemoClaw."""
        result: list[BaseMessage] = []
        offset = 0
        batch_size = 100
        while True:
            page = self._client.list(
                session_id=self._session_id,
                namespace=self._namespace,
                agent_id=self._agent_id,
                tags=[self._tag],
                limit=batch_size,
                offset=offset,
            )
            for memory in page.memories:
                meta = memory.metadata or {}
                role = str(meta.get("role", "user"))
                result.append(_role_to_message(role, memory.content))
            offset += len(page.memories)
            if offset >= page.total or not page.memories:
                break
        return result

    def add_messages(self, messages: Sequence[BaseMessage]) -> None:
        """Store multiple messages in MemoClaw.

        Uses batch storage when possible for efficiency.
        """
        if not messages:
            return

        items = []
        for message in messages:
            role = _message_to_role(message)
            items.append(
                {
                    "content": message.content if isinstance(message.content, str) else str(message.content),
                    "metadata": {"tags": [self._tag], "role": role},
                    "namespace": self._namespace,
                    "session_id": self._session_id,
                    "agent_id": self._agent_id,
                }
            )

        # Use batch store for efficiency (up to 100 at a time)
        for i in range(0, len(items), 100):
            chunk = items[i : i + 100]
            # Clean None values from each item
            cleaned = [
                {k: v for k, v in item.items() if v is not None}
                for item in chunk
            ]
            self._client.store_batch(cleaned)

    def add_message(self, message: BaseMessage) -> None:
        """Store a single message in MemoClaw."""
        role = _message_to_role(message)
        content = message.content if isinstance(message.content, str) else str(message.content)
        kwargs: dict[str, Any] = {
            "tags": [self._tag],
            "session_id": self._session_id,
            "metadata": {"role": role},
        }
        if self._namespace is not None:
            kwargs["namespace"] = self._namespace
        if self._agent_id is not None:
            kwargs["agent_id"] = self._agent_id
        self._client.store(content, **kwargs)

    def clear(self) -> None:
        """Delete all messages for this session from MemoClaw."""
        ids: list[str] = []
        offset = 0
        batch_size = 100
        while True:
            page = self._client.list(
                session_id=self._session_id,
                namespace=self._namespace,
                agent_id=self._agent_id,
                tags=[self._tag],
                limit=batch_size,
                offset=offset,
            )
            ids.extend(m.id for m in page.memories)
            offset += len(page.memories)
            if offset >= page.total or not page.memories:
                break
        if ids:
            self._client.delete_batch(ids)


# ── Retriever ────────────────────────────────────────────────────────────────


class MemoClawRetriever(BaseRetriever):
    """LangChain retriever that performs semantic recall over MemoClaw memories.

    Each recalled memory is returned as a LangChain :class:`Document` with
    the memory content as ``page_content`` and memory metadata (id, importance,
    similarity, etc.) in ``metadata``.

    Args:
        client: A configured :class:`~memoclaw.MemoClaw` instance.
        namespace: Optional MemoClaw namespace filter.
        tags: Optional tag filter for recall.
        top_k: Maximum number of memories to return (default: 5).
        min_similarity: Minimum similarity threshold (0.0-1.0).
        session_id: Optional session ID filter.
        agent_id: Optional agent ID filter.
        include_relations: Whether to include related memories.

    Example::

        retriever = MemoClawRetriever(
            client=client,
            namespace="project-x",
            top_k=10,
            min_similarity=0.7,
        )
        docs = retriever.invoke("What are the user's preferences?")
        for doc in docs:
            print(doc.page_content, doc.metadata["similarity"])
    """

    # Pydantic fields -- BaseRetriever is a Pydantic model
    client: Any  # MemoClaw instance (Any to avoid pydantic validation issues)
    namespace: str | None = None
    tags: list[str] | None = None
    top_k: int = 5
    min_similarity: float | None = None
    session_id: str | None = None
    agent_id: str | None = None
    include_relations: bool = False

    model_config = {"arbitrary_types_allowed": True}

    def _get_relevant_documents(
        self,
        query: str,
        *,
        run_manager: CallbackManagerForRetrieverRun | None = None,
    ) -> list[Document]:
        """Perform semantic recall and return results as Documents."""
        kwargs: dict[str, Any] = {
            "limit": self.top_k,
        }
        if self.namespace is not None:
            kwargs["namespace"] = self.namespace
        if self.tags is not None:
            kwargs["tags"] = self.tags
        if self.min_similarity is not None:
            kwargs["min_similarity"] = self.min_similarity
        if self.session_id is not None:
            kwargs["session_id"] = self.session_id
        if self.agent_id is not None:
            kwargs["agent_id"] = self.agent_id
        if self.include_relations:
            kwargs["include_relations"] = True

        response = self.client.recall(query, **kwargs)

        documents: list[Document] = []
        for memory in response.memories:
            metadata: dict[str, Any] = {
                "id": memory.id,
                "similarity": memory.similarity,
                "importance": memory.importance,
                "memory_type": memory.memory_type,
                "namespace": memory.namespace,
                "created_at": memory.created_at,
            }
            if memory.metadata:
                metadata["memory_metadata"] = dict(memory.metadata)
            if memory.session_id:
                metadata["session_id"] = memory.session_id
            if memory.agent_id:
                metadata["agent_id"] = memory.agent_id

            documents.append(
                Document(
                    page_content=memory.content,
                    metadata=metadata,
                )
            )

        return documents


# ── Async Chat Message History ───────────────────────────────────────────────


class AsyncMemoClawChatMessageHistory(BaseChatMessageHistory):
    """Async LangChain chat message history backed by MemoClaw.

    Uses :class:`~memoclaw.AsyncMemoClaw` for non-blocking API calls.
    The synchronous ``messages`` property falls back to raising
    ``NotImplementedError`` — use :meth:`aget_messages` instead.

    Args:
        client: A configured :class:`~memoclaw.AsyncMemoClaw` instance.
        session_id: Unique session identifier.
        namespace: Optional MemoClaw namespace for isolation.
        agent_id: Optional agent identifier.
        tag: Tag used to identify chat messages (default: ``"chat_message"``).

    Example::

        from memoclaw import AsyncMemoClaw
        from memoclaw.integrations.langchain import AsyncMemoClawChatMessageHistory

        client = await AsyncMemoClaw.create(private_key="0x...")
        history = AsyncMemoClawChatMessageHistory(client=client, session_id="chat-42")
        await history.aadd_messages([HumanMessage(content="I prefer dark mode")])
        messages = await history.aget_messages()
    """

    def __init__(
        self,
        client: AsyncMemoClaw,
        session_id: str,
        *,
        namespace: str | None = None,
        agent_id: str | None = None,
        tag: str = "chat_message",
    ) -> None:
        self._client = client
        self._session_id = session_id
        self._namespace = namespace
        self._agent_id = agent_id
        self._tag = tag

    @property
    def messages(self) -> list[BaseMessage]:  # type: ignore[override]
        """Sync access is not supported — use ``aget_messages()`` instead."""
        raise NotImplementedError(
            "AsyncMemoClawChatMessageHistory does not support synchronous access. "
            "Use `await history.aget_messages()` instead."
        )

    async def aget_messages(self) -> list[BaseMessage]:  # type: ignore[override]
        """Retrieve all messages for this session from MemoClaw (async)."""
        result: list[BaseMessage] = []
        offset = 0
        batch_size = 100
        while True:
            page = await self._client.list(
                session_id=self._session_id,
                namespace=self._namespace,
                agent_id=self._agent_id,
                tags=[self._tag],
                limit=batch_size,
                offset=offset,
            )
            for memory in page.memories:
                meta = memory.metadata or {}
                role = str(meta.get("role", "user"))
                result.append(_role_to_message(role, memory.content))
            offset += len(page.memories)
            if offset >= page.total or not page.memories:
                break
        return result

    def add_messages(self, messages: Sequence[BaseMessage]) -> None:
        """Sync add is not supported — use ``aadd_messages()`` instead."""
        raise NotImplementedError(
            "AsyncMemoClawChatMessageHistory does not support synchronous access. "
            "Use `await history.aadd_messages(messages)` instead."
        )

    async def aadd_messages(self, messages: Sequence[BaseMessage]) -> None:
        """Store multiple messages in MemoClaw (async).

        Uses batch storage when possible for efficiency.
        """
        if not messages:
            return

        items = []
        for message in messages:
            role = _message_to_role(message)
            items.append(
                {
                    "content": message.content if isinstance(message.content, str) else str(message.content),
                    "metadata": {"tags": [self._tag], "role": role},
                    "namespace": self._namespace,
                    "session_id": self._session_id,
                    "agent_id": self._agent_id,
                }
            )

        for i in range(0, len(items), 100):
            chunk = items[i : i + 100]
            cleaned = [
                {k: v for k, v in item.items() if v is not None}
                for item in chunk
            ]
            await self._client.store_batch(cleaned)

    def clear(self) -> None:
        """Sync clear is not supported — use ``aclear()`` instead."""
        raise NotImplementedError(
            "AsyncMemoClawChatMessageHistory does not support synchronous access. "
            "Use `await history.aclear()` instead."
        )

    async def aclear(self) -> None:
        """Delete all messages for this session from MemoClaw (async)."""
        ids: list[str] = []
        offset = 0
        batch_size = 100
        while True:
            page = await self._client.list(
                session_id=self._session_id,
                namespace=self._namespace,
                agent_id=self._agent_id,
                tags=[self._tag],
                limit=batch_size,
                offset=offset,
            )
            ids.extend(m.id for m in page.memories)
            offset += len(page.memories)
            if offset >= page.total or not page.memories:
                break
        if ids:
            await self._client.delete_batch(ids)


# ── Async Retriever ──────────────────────────────────────────────────────────


class AsyncMemoClawRetriever(BaseRetriever):
    """Async LangChain retriever backed by MemoClaw.

    Uses :class:`~memoclaw.AsyncMemoClaw` for non-blocking semantic recall.
    Supports both ``ainvoke()`` (preferred) and ``invoke()`` will raise
    ``NotImplementedError``.

    Args:
        client: A configured :class:`~memoclaw.AsyncMemoClaw` instance.
        namespace: Optional MemoClaw namespace filter.
        tags: Optional tag filter for recall.
        top_k: Maximum number of memories to return (default: 5).
        min_similarity: Minimum similarity threshold (0.0–1.0).
        session_id: Optional session ID filter.
        agent_id: Optional agent ID filter.
        include_relations: Whether to include related memories.

    Example::

        retriever = AsyncMemoClawRetriever(
            client=client,
            namespace="project-x",
            top_k=10,
        )
        docs = await retriever.ainvoke("What are the user's preferences?")
    """

    # Pydantic fields
    client: Any  # AsyncMemoClaw instance
    namespace: str | None = None
    tags: list[str] | None = None
    top_k: int = 5
    min_similarity: float | None = None
    session_id: str | None = None
    agent_id: str | None = None
    include_relations: bool = False

    model_config = {"arbitrary_types_allowed": True}

    def _get_relevant_documents(
        self,
        query: str,
        *,
        run_manager: CallbackManagerForRetrieverRun | None = None,
    ) -> list[Document]:
        """Sync access is not supported — use ``ainvoke()`` instead."""
        raise NotImplementedError(
            "AsyncMemoClawRetriever does not support synchronous access. "
            "Use `await retriever.ainvoke(query)` instead."
        )

    async def _aget_relevant_documents(
        self,
        query: str,
        *,
        run_manager: Any = None,
    ) -> list[Document]:
        """Perform async semantic recall and return results as Documents."""
        kwargs: dict[str, Any] = {
            "limit": self.top_k,
        }
        if self.namespace is not None:
            kwargs["namespace"] = self.namespace
        if self.tags is not None:
            kwargs["tags"] = self.tags
        if self.min_similarity is not None:
            kwargs["min_similarity"] = self.min_similarity
        if self.session_id is not None:
            kwargs["session_id"] = self.session_id
        if self.agent_id is not None:
            kwargs["agent_id"] = self.agent_id
        if self.include_relations:
            kwargs["include_relations"] = True

        response = await self.client.recall(query, **kwargs)

        documents: list[Document] = []
        for memory in response.memories:
            metadata: dict[str, Any] = {
                "id": memory.id,
                "similarity": memory.similarity,
                "importance": memory.importance,
                "memory_type": memory.memory_type,
                "namespace": memory.namespace,
                "created_at": memory.created_at,
            }
            if memory.metadata:
                metadata["memory_metadata"] = dict(memory.metadata)
            if memory.session_id:
                metadata["session_id"] = memory.session_id
            if memory.agent_id:
                metadata["agent_id"] = memory.agent_id

            documents.append(
                Document(
                    page_content=memory.content,
                    metadata=metadata,
                )
            )

        return documents


__all__ = [
    "AsyncMemoClawChatMessageHistory",
    "AsyncMemoClawRetriever",
    "MemoClawChatMessageHistory",
    "MemoClawRetriever",
]
