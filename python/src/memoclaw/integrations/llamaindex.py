"""LlamaIndex integration for MemoClaw.

Provides:
- ``MemoClawRetriever``: LlamaIndex-compatible retriever that performs semantic
  recall over stored memories.
- ``MemoClawMemoryStore``: Convenience wrapper for storing and managing memories
  through a LlamaIndex-friendly interface.
- ``AsyncMemoClawRetriever``: Async variant using ``AsyncMemoClaw``.
- ``AsyncMemoClawMemoryStore``: Async variant using ``AsyncMemoClaw``.

Install with::

    pip install memoclaw[llamaindex]

Example — Retriever::

    from memoclaw import MemoClaw
    from memoclaw.integrations.llamaindex import MemoClawRetriever

    client = MemoClaw(private_key="0x...")
    retriever = MemoClawRetriever(client=client, namespace="project-x")
    nodes = retriever.retrieve("user preferences")
    for node in nodes:
        print(node.text, node.score)

Example — Memory store::

    from memoclaw import MemoClaw
    from memoclaw.integrations.llamaindex import MemoClawMemoryStore

    client = MemoClaw(private_key="0x...")
    store = MemoClawMemoryStore(client=client, namespace="project-x")
    store.put("User prefers dark mode", tags=["preferences"], importance=0.9)
    results = store.search("user UI preferences", top_k=5)
"""

from __future__ import annotations

from typing import Any, List

try:
    from llama_index.core.retrievers import BaseRetriever
    from llama_index.core.schema import NodeWithScore, QueryBundle, TextNode
except ImportError as exc:
    raise ImportError(
        "LlamaIndex integration requires llama-index-core. "
        "Install it with: pip install memoclaw[llamaindex]"
    ) from exc

from memoclaw.client import AsyncMemoClaw, MemoClaw


# ── Retriever ────────────────────────────────────────────────────────────────


class MemoClawRetriever(BaseRetriever):
    """LlamaIndex retriever that performs semantic recall over MemoClaw memories.

    Each recalled memory is returned as a :class:`NodeWithScore` wrapping a
    :class:`TextNode`.  The similarity score from MemoClaw is used as the node
    score.

    Args:
        client: A configured :class:`~memoclaw.MemoClaw` instance.
        namespace: Optional MemoClaw namespace filter.
        tags: Optional tag filter for recall.
        top_k: Maximum number of memories to return (default: 5).
        min_similarity: Minimum similarity threshold (0.0–1.0).
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
        nodes = retriever.retrieve("What are the user's preferences?")
        for node in nodes:
            print(node.text, node.score)
    """

    def __init__(
        self,
        client: MemoClaw,
        *,
        namespace: str | None = None,
        tags: list[str] | None = None,
        top_k: int = 5,
        min_similarity: float | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
        include_relations: bool = False,
    ) -> None:
        super().__init__()
        self._client = client
        self._namespace = namespace
        self._tags = tags
        self._top_k = top_k
        self._min_similarity = min_similarity
        self._session_id = session_id
        self._agent_id = agent_id
        self._include_relations = include_relations

    def _retrieve(self, query_bundle: QueryBundle) -> List[NodeWithScore]:
        """Perform semantic recall and return results as NodeWithScore."""
        query = query_bundle.query_str

        kwargs: dict[str, Any] = {
            "limit": self._top_k,
        }
        if self._namespace is not None:
            kwargs["namespace"] = self._namespace
        if self._tags is not None:
            kwargs["tags"] = self._tags
        if self._min_similarity is not None:
            kwargs["min_similarity"] = self._min_similarity
        if self._session_id is not None:
            kwargs["session_id"] = self._session_id
        if self._agent_id is not None:
            kwargs["agent_id"] = self._agent_id
        if self._include_relations:
            kwargs["include_relations"] = True

        response = self._client.recall(query, **kwargs)

        nodes: list[NodeWithScore] = []
        for memory in response.memories:
            metadata: dict[str, Any] = {
                "id": memory.id,
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

            node = TextNode(
                text=memory.content,
                id_=memory.id,
                metadata=metadata,
            )
            nodes.append(NodeWithScore(node=node, score=memory.similarity))

        return nodes


# ── Memory Store ─────────────────────────────────────────────────────────────


class MemoClawMemoryStore:
    """LlamaIndex-friendly wrapper for storing and managing MemoClaw memories.

    This is a convenience class that wraps the MemoClaw client with
    sensible defaults for use in LlamaIndex pipelines.  It is **not** a
    LlamaIndex ``BaseStore`` subclass — it intentionally provides a simpler,
    memory-oriented API.

    Args:
        client: A configured :class:`~memoclaw.MemoClaw` instance.
        namespace: Optional default namespace for all operations.
        agent_id: Optional default agent ID.
        session_id: Optional default session ID.

    Example::

        store = MemoClawMemoryStore(client=client, namespace="project-x")
        store.put("User prefers dark mode", tags=["preferences"])
        nodes = store.search("UI preferences")
    """

    def __init__(
        self,
        client: MemoClaw,
        *,
        namespace: str | None = None,
        agent_id: str | None = None,
        session_id: str | None = None,
    ) -> None:
        self._client = client
        self._namespace = namespace
        self._agent_id = agent_id
        self._session_id = session_id

    def put(
        self,
        content: str,
        *,
        tags: list[str] | None = None,
        importance: float | None = None,
        namespace: str | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> Any:
        """Store a memory and return the store result.

        Parameters override the defaults set at construction time.
        """
        kwargs: dict[str, Any] = {}
        if tags is not None:
            kwargs["tags"] = tags
        if importance is not None:
            kwargs["importance"] = importance
        if metadata is not None:
            kwargs["metadata"] = metadata

        ns = namespace if namespace is not None else self._namespace
        if ns is not None:
            kwargs["namespace"] = ns

        sid = session_id if session_id is not None else self._session_id
        if sid is not None:
            kwargs["session_id"] = sid

        aid = agent_id if agent_id is not None else self._agent_id
        if aid is not None:
            kwargs["agent_id"] = aid

        return self._client.store(content, **kwargs)

    def put_batch(
        self,
        items: list[dict[str, Any]],
    ) -> Any:
        """Store multiple memories at once.

        Each item in *items* is a dict with at least ``"content"`` and
        optionally ``"tags"``, ``"importance"``, ``"namespace"``, etc.
        Items without an explicit ``"namespace"`` inherit the store default.
        """
        prepared: list[dict[str, Any]] = []
        for item in items:
            entry = dict(item)
            if "namespace" not in entry and self._namespace is not None:
                entry["namespace"] = self._namespace
            if "session_id" not in entry and self._session_id is not None:
                entry["session_id"] = self._session_id
            if "agent_id" not in entry and self._agent_id is not None:
                entry["agent_id"] = self._agent_id
            prepared.append(entry)
        return self._client.store_batch(prepared)

    def search(
        self,
        query: str,
        *,
        top_k: int = 5,
        tags: list[str] | None = None,
        min_similarity: float | None = None,
        namespace: str | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
    ) -> list[NodeWithScore]:
        """Semantic search returning LlamaIndex :class:`NodeWithScore` objects."""
        kwargs: dict[str, Any] = {"limit": top_k}

        ns = namespace if namespace is not None else self._namespace
        if ns is not None:
            kwargs["namespace"] = ns
        if tags is not None:
            kwargs["tags"] = tags
        if min_similarity is not None:
            kwargs["min_similarity"] = min_similarity

        sid = session_id if session_id is not None else self._session_id
        if sid is not None:
            kwargs["session_id"] = sid

        aid = agent_id if agent_id is not None else self._agent_id
        if aid is not None:
            kwargs["agent_id"] = aid

        response = self._client.recall(query, **kwargs)

        nodes: list[NodeWithScore] = []
        for memory in response.memories:
            metadata: dict[str, Any] = {
                "id": memory.id,
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

            node = TextNode(
                text=memory.content,
                id_=memory.id,
                metadata=metadata,
            )
            nodes.append(NodeWithScore(node=node, score=memory.similarity))

        return nodes

    def delete(self, memory_id: str) -> Any:
        """Delete a memory by ID."""
        return self._client.delete(memory_id)

    def delete_batch(self, memory_ids: list[str]) -> Any:
        """Delete multiple memories by ID."""
        return self._client.delete_batch(memory_ids)

    def as_retriever(
        self,
        *,
        top_k: int = 5,
        tags: list[str] | None = None,
        min_similarity: float | None = None,
        include_relations: bool = False,
    ) -> MemoClawRetriever:
        """Create a :class:`MemoClawRetriever` sharing this store's defaults."""
        return MemoClawRetriever(
            client=self._client,
            namespace=self._namespace,
            tags=tags,
            top_k=top_k,
            min_similarity=min_similarity,
            session_id=self._session_id,
            agent_id=self._agent_id,
            include_relations=include_relations,
        )


# ── Async Retriever ──────────────────────────────────────────────────────────


class AsyncMemoClawRetriever(BaseRetriever):
    """Async LlamaIndex retriever that performs semantic recall over MemoClaw memories.

    Uses :class:`~memoclaw.AsyncMemoClaw` for non-blocking API calls.
    Supports ``aretrieve()`` for async usage.

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

        from memoclaw import AsyncMemoClaw
        from memoclaw.integrations.llamaindex import AsyncMemoClawRetriever

        client = await AsyncMemoClaw.create(private_key="0x...")
        retriever = AsyncMemoClawRetriever(client=client, namespace="project-x")
        nodes = await retriever.aretrieve("user preferences")
    """

    def __init__(
        self,
        client: AsyncMemoClaw,
        *,
        namespace: str | None = None,
        tags: list[str] | None = None,
        top_k: int = 5,
        min_similarity: float | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
        include_relations: bool = False,
    ) -> None:
        super().__init__()
        self._client = client
        self._namespace = namespace
        self._tags = tags
        self._top_k = top_k
        self._min_similarity = min_similarity
        self._session_id = session_id
        self._agent_id = agent_id
        self._include_relations = include_relations

    def _retrieve(self, query_bundle: QueryBundle) -> List[NodeWithScore]:
        """Sync access is not supported — use ``aretrieve()`` instead."""
        raise NotImplementedError(
            "AsyncMemoClawRetriever does not support synchronous access. "
            "Use `await retriever.aretrieve(query)` instead."
        )

    async def _aretrieve(self, query_bundle: QueryBundle) -> List[NodeWithScore]:
        """Perform async semantic recall and return results as NodeWithScore."""
        query = query_bundle.query_str

        kwargs: dict[str, Any] = {
            "limit": self._top_k,
        }
        if self._namespace is not None:
            kwargs["namespace"] = self._namespace
        if self._tags is not None:
            kwargs["tags"] = self._tags
        if self._min_similarity is not None:
            kwargs["min_similarity"] = self._min_similarity
        if self._session_id is not None:
            kwargs["session_id"] = self._session_id
        if self._agent_id is not None:
            kwargs["agent_id"] = self._agent_id
        if self._include_relations:
            kwargs["include_relations"] = True

        response = await self._client.recall(query, **kwargs)

        nodes: list[NodeWithScore] = []
        for memory in response.memories:
            metadata: dict[str, Any] = {
                "id": memory.id,
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

            node = TextNode(
                text=memory.content,
                id_=memory.id,
                metadata=metadata,
            )
            nodes.append(NodeWithScore(node=node, score=memory.similarity))

        return nodes


# ── Async Memory Store ───────────────────────────────────────────────────────


class AsyncMemoClawMemoryStore:
    """Async LlamaIndex-friendly wrapper for storing and managing MemoClaw memories.

    Uses :class:`~memoclaw.AsyncMemoClaw` for non-blocking API calls.

    Args:
        client: A configured :class:`~memoclaw.AsyncMemoClaw` instance.
        namespace: Optional default namespace for all operations.
        agent_id: Optional default agent ID.
        session_id: Optional default session ID.

    Example::

        from memoclaw import AsyncMemoClaw
        from memoclaw.integrations.llamaindex import AsyncMemoClawMemoryStore

        client = await AsyncMemoClaw.create(private_key="0x...")
        store = AsyncMemoClawMemoryStore(client=client, namespace="project-x")
        await store.put("User prefers dark mode", tags=["preferences"])
        nodes = await store.search("UI preferences")
    """

    def __init__(
        self,
        client: AsyncMemoClaw,
        *,
        namespace: str | None = None,
        agent_id: str | None = None,
        session_id: str | None = None,
    ) -> None:
        self._client = client
        self._namespace = namespace
        self._agent_id = agent_id
        self._session_id = session_id

    async def put(
        self,
        content: str,
        *,
        tags: list[str] | None = None,
        importance: float | None = None,
        namespace: str | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> Any:
        """Store a memory and return the store result (async).

        Parameters override the defaults set at construction time.
        """
        kwargs: dict[str, Any] = {}
        if tags is not None:
            kwargs["tags"] = tags
        if importance is not None:
            kwargs["importance"] = importance
        if metadata is not None:
            kwargs["metadata"] = metadata

        ns = namespace if namespace is not None else self._namespace
        if ns is not None:
            kwargs["namespace"] = ns

        sid = session_id if session_id is not None else self._session_id
        if sid is not None:
            kwargs["session_id"] = sid

        aid = agent_id if agent_id is not None else self._agent_id
        if aid is not None:
            kwargs["agent_id"] = aid

        return await self._client.store(content, **kwargs)

    async def put_batch(
        self,
        items: list[dict[str, Any]],
    ) -> Any:
        """Store multiple memories at once (async).

        Each item in *items* is a dict with at least ``"content"`` and
        optionally ``"tags"``, ``"importance"``, ``"namespace"``, etc.
        Items without an explicit ``"namespace"`` inherit the store default.
        """
        prepared: list[dict[str, Any]] = []
        for item in items:
            entry = dict(item)
            if "namespace" not in entry and self._namespace is not None:
                entry["namespace"] = self._namespace
            if "session_id" not in entry and self._session_id is not None:
                entry["session_id"] = self._session_id
            if "agent_id" not in entry and self._agent_id is not None:
                entry["agent_id"] = self._agent_id
            prepared.append(entry)
        return await self._client.store_batch(prepared)

    async def search(
        self,
        query: str,
        *,
        top_k: int = 5,
        tags: list[str] | None = None,
        min_similarity: float | None = None,
        namespace: str | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
    ) -> list[NodeWithScore]:
        """Semantic search returning LlamaIndex :class:`NodeWithScore` objects (async)."""
        kwargs: dict[str, Any] = {"limit": top_k}

        ns = namespace if namespace is not None else self._namespace
        if ns is not None:
            kwargs["namespace"] = ns
        if tags is not None:
            kwargs["tags"] = tags
        if min_similarity is not None:
            kwargs["min_similarity"] = min_similarity

        sid = session_id if session_id is not None else self._session_id
        if sid is not None:
            kwargs["session_id"] = sid

        aid = agent_id if agent_id is not None else self._agent_id
        if aid is not None:
            kwargs["agent_id"] = aid

        response = await self._client.recall(query, **kwargs)

        nodes: list[NodeWithScore] = []
        for memory in response.memories:
            metadata: dict[str, Any] = {
                "id": memory.id,
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

            node = TextNode(
                text=memory.content,
                id_=memory.id,
                metadata=metadata,
            )
            nodes.append(NodeWithScore(node=node, score=memory.similarity))

        return nodes

    async def delete(self, memory_id: str) -> Any:
        """Delete a memory by ID (async)."""
        return await self._client.delete(memory_id)

    async def delete_batch(self, memory_ids: list[str]) -> Any:
        """Delete multiple memories by ID (async)."""
        return await self._client.delete_batch(memory_ids)

    def as_retriever(
        self,
        *,
        top_k: int = 5,
        tags: list[str] | None = None,
        min_similarity: float | None = None,
        include_relations: bool = False,
    ) -> AsyncMemoClawRetriever:
        """Create an :class:`AsyncMemoClawRetriever` sharing this store's defaults."""
        return AsyncMemoClawRetriever(
            client=self._client,
            namespace=self._namespace,
            tags=tags,
            top_k=top_k,
            min_similarity=min_similarity,
            session_id=self._session_id,
            agent_id=self._agent_id,
            include_relations=include_relations,
        )


__all__ = [
    "AsyncMemoClawMemoryStore",
    "AsyncMemoClawRetriever",
    "MemoClawMemoryStore",
    "MemoClawRetriever",
]
