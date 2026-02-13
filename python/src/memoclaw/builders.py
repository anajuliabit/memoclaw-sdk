"""Fluent builder patterns for MemoClaw SDK.

This module provides builder classes for constructing complex queries
and managing memory operations with a fluent, chainable API.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Iterator

from .types import MemoryType, StoreInput, Memory, RecallResponse, RelationType, StoreResult

if TYPE_CHECKING:
    from .client import AsyncMemoClaw, MemoClaw

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

class MemoryBuilder:
    """Fluent builder for creating memory content.
    
    Example::
    
        builder = MemoryBuilder()
        memory = (
            builder.content("User prefers dark mode")
            .importance(0.9)
            .tags(["preferences", "ui"])
            .namespace("app-settings")
            .memory_type("preference")
            .pinned(True)
            .build()
        )
        client.store(**memory)
    """

    def __init__(self) -> None:
        self._content: str | None = None
        self._importance: float | None = None
        self._tags: list[str] | None = None
        self._namespace: str | None = None
        self._memory_type: MemoryType | None = None
        self._session_id: str | None = None
        self._agent_id: str | None = None
        self._expires_at: str | None = None
        self._pinned: bool | None = None
        self._metadata: dict[str, Any] | None = None

    def content(self, content: str) -> MemoryBuilder:
        """Set the memory content."""
        self._content = content
        return self

    def importance(self, importance: float) -> MemoryBuilder:
        """Set importance (0.0 to 1.0)."""
        if not 0.0 <= importance <= 1.0:
            raise ValueError("importance must be between 0.0 and 1.0")
        self._importance = importance
        return self

    def tags(self, tags: list[str]) -> MemoryBuilder:
        """Set tags for the memory."""
        self._tags = tags
        return self

    def add_tag(self, tag: str) -> MemoryBuilder:
        """Add a single tag."""
        if self._tags is None:
            self._tags = []
        self._tags.append(tag)
        return self

    def namespace(self, namespace: str) -> MemoryBuilder:
        """Set namespace."""
        self._namespace = namespace
        return self

    def memory_type(self, memory_type: MemoryType) -> MemoryBuilder:
        """Set memory type."""
        self._memory_type = memory_type
        return self

    def session(self, session_id: str) -> MemoryBuilder:
        """Set session ID."""
        self._session_id = session_id
        return self

    def agent(self, agent_id: str) -> MemoryBuilder:
        """Set agent ID."""
        self._agent_id = agent_id
        return self

    def expires_at(self, expires_at: str) -> MemoryBuilder:
        """Set expiration timestamp (ISO 8601 format)."""
        self._expires_at = expires_at
        return self

    def expires_in_days(self, days: int) -> MemoryBuilder:
        """Set expiration relative to now (in days)."""
        from datetime import datetime, timedelta
        expires = datetime.utcnow() + timedelta(days=days)
        self._expires_at = expires.isoformat() + "Z"
        return self

    def pinned(self, pinned: bool = True) -> MemoryBuilder:
        """Set pinned status."""
        self._pinned = pinned
        return self

    def metadata(self, metadata: dict[str, Any]) -> MemoryBuilder:
        """Set custom metadata."""
        self._metadata = metadata
        return self

    def add_metadata(self, key: str, value: Any) -> MemoryBuilder:
        """Add a single metadata key-value pair."""
        if self._metadata is None:
            self._metadata = {}
        self._metadata[key] = value
        return self

    def build(self) -> StoreInput:
        """Build the StoreInput object."""
        if not self._content:
            raise ValueError("content is required")
        return StoreInput(
            content=self._content,
            importance=self._importance,
            tags=self._tags,
            namespace=self._namespace,
            memory_type=self._memory_type,
            session_id=self._session_id,
            agent_id=self._agent_id,
            expires_at=self._expires_at,
            pinned=self._pinned,
            metadata=self._metadata,
        )

    def to_dict(self) -> dict[str, Any]:
        """Build as dictionary (for dict-based APIs)."""
        return self.build().model_dump(exclude_none=True)


class RecallBuilder:
    """Fluent builder for recall queries.
    
    Example::
    
        results = client.recall(
            **RecallBuilder()
                .query("user interface preferences")
                .limit(10)
                .min_similarity(0.7)
                .namespace("app-settings")
                .include_relations(True)
                .build()
        )
    """

    def __init__(self) -> None:
        self._query: str | None = None
        self._limit: int | None = None
        self._min_similarity: float | None = None
        self._namespace: str | None = None
        self._tags: list[str] | None = None
        self._session_id: str | None = None
        self._agent_id: str | None = None
        self._include_relations: bool | None = None
        self._memory_type: MemoryType | None = None

    def query(self, query: str) -> RecallBuilder:
        """Set the search query."""
        self._query = query
        return self

    def limit(self, limit: int) -> RecallBuilder:
        """Set maximum results."""
        self._limit = limit
        return self

    def min_similarity(self, min_similarity: float) -> RecallBuilder:
        """Set minimum similarity threshold (0.0 to 1.0)."""
        if not 0.0 <= min_similarity <= 1.0:
            raise ValueError("min_similarity must be between 0.0 and 1.0")
        self._min_similarity = min_similarity
        return self

    def namespace(self, namespace: str) -> RecallBuilder:
        """Filter by namespace."""
        self._namespace = namespace
        return self

    def tags(self, tags: list[str]) -> RecallBuilder:
        """Filter by tags."""
        self._tags = tags
        return self

    def session(self, session_id: str) -> RecallBuilder:
        """Filter by session."""
        self._session_id = session_id
        return self

    def agent(self, agent_id: str) -> RecallBuilder:
        """Filter by agent."""
        self._agent_id = agent_id
        return self

    def include_relations(self, include: bool = True) -> RecallBuilder:
        """Include related memories in results."""
        self._include_relations = include
        return self

    def memory_type(self, memory_type: MemoryType) -> RecallBuilder:
        """Filter by memory type."""
        self._memory_type = memory_type
        return self

    def build(self) -> dict[str, Any]:
        """Build the recall parameters dict."""
        if not self._query:
            raise ValueError("query is required")
        
        params: dict[str, Any] = {"query": self._query}
        
        if self._limit is not None:
            params["limit"] = self._limit
        if self._min_similarity is not None:
            params["min_similarity"] = self._min_similarity
        if self._namespace is not None:
            params["namespace"] = self._namespace
        if self._session_id is not None:
            params["session_id"] = self._session_id
        if self._agent_id is not None:
            params["agent_id"] = self._agent_id
        if self._include_relations is not None:
            params["include_relations"] = self._include_relations
        
        if self._tags is not None or self._memory_type is not None:
            filters: dict[str, Any] = {}
            if self._tags is not None:
                filters["tags"] = self._tags
            if self._memory_type is not None:
                filters["memory_type"] = self._memory_type
            params["filters"] = filters
        
        return params


class RecallQuery:
    """Fluent builder for constructing recall queries.

    Allows chaining multiple filters and options before executing
    the search query.

    Example:
        >>> results = (RecallQuery(client)
        ...     .with_query("Python preferences")
        ...     .with_limit(5)
        ...     .execute())
    """

    def __init__(self, client: "MemoClaw") -> None:
        self._client = client
        self._query: str = ""
        self._limit: int | None = None
        self._min_similarity: float | None = None
        self._namespace: str | None = None
        self._tags: list[str] | None = None
        self._session_id: str | None = None
        self._agent_id: str | None = None
        self._include_relations: bool | None = None
        self._after: str | None = None
        self._memory_type: MemoryType | None = None

    def with_query(self, query: str) -> RecallQuery:
        """Set the search query."""
        self._query = query
        return self

    def with_limit(self, limit: int) -> RecallQuery:
        """Set the maximum number of results."""
        self._limit = limit
        return self

    def with_min_similarity(self, min_similarity: float) -> RecallQuery:
        """Set minimum similarity threshold (0.0 to 1.0)."""
        if not 0.0 <= min_similarity <= 1.0:
            raise ValueError("min_similarity must be between 0.0 and 1.0")
        self._min_similarity = min_similarity
        return self

    def with_namespace(self, namespace: str) -> RecallQuery:
        """Filter by namespace."""
        self._namespace = namespace
        return self

    def with_tags(self, tags: list[str]) -> RecallQuery:
        """Filter by tags (AND logic)."""
        self._tags = tags
        return self

    def with_session_id(self, session_id: str) -> RecallQuery:
        """Filter by session ID."""
        self._session_id = session_id
        return self

    def with_agent_id(self, agent_id: str) -> RecallQuery:
        """Filter by agent ID."""
        self._agent_id = agent_id
        return self

    def with_memory_type(self, memory_type: MemoryType) -> RecallQuery:
        """Filter by memory type."""
        self._memory_type = memory_type
        return self

    def with_after(self, after: str) -> RecallQuery:
        """Filter memories created after this ISO timestamp."""
        self._after = after
        return self

    def include_relations(self, include: bool = True) -> RecallQuery:
        """Include related memories in results."""
        self._include_relations = include
        return self

    def execute(self) -> RecallResponse:
        """Execute the recall query."""
        if not self._query:
            raise ValueError("Query is required. Use .with_query() to set it.")
        return self._client.recall(
            self._query,
            limit=self._limit,
            min_similarity=self._min_similarity,
            namespace=self._namespace,
            tags=self._tags,
            session_id=self._session_id,
            agent_id=self._agent_id,
            include_relations=self._include_relations,
            after=self._after,
            memory_type=self._memory_type,
        )

    def __iter__(self) -> Iterator[RecallResponse]:
        """Iterate by executing and yielding results (single result)."""
        yield self.execute()


class AsyncRecallQuery:
    """Async version of RecallQuery for use with AsyncMemoClaw."""

    def __init__(self, client: "AsyncMemoClaw") -> None:
        self._client = client
        self._query: str = ""
        self._limit: int | None = None
        self._min_similarity: float | None = None
        self._namespace: str | None = None
        self._tags: list[str] | None = None
        self._session_id: str | None = None
        self._agent_id: str | None = None
        self._include_relations: bool | None = None
        self._after: str | None = None
        self._memory_type: MemoryType | None = None

    def with_query(self, query: str) -> AsyncRecallQuery:
        self._query = query
        return self

    def with_limit(self, limit: int) -> AsyncRecallQuery:
        self._limit = limit
        return self

    def with_min_similarity(self, min_similarity: float) -> AsyncRecallQuery:
        if not 0.0 <= min_similarity <= 1.0:
            raise ValueError("min_similarity must be between 0.0 and 1.0")
        self._min_similarity = min_similarity
        return self

    def with_namespace(self, namespace: str) -> AsyncRecallQuery:
        self._namespace = namespace
        return self

    def with_tags(self, tags: list[str]) -> AsyncRecallQuery:
        self._tags = tags
        return self

    def with_session_id(self, session_id: str) -> AsyncRecallQuery:
        self._session_id = session_id
        return self

    def with_agent_id(self, agent_id: str) -> AsyncRecallQuery:
        self._agent_id = agent_id
        return self

    def with_memory_type(self, memory_type: MemoryType) -> AsyncRecallQuery:
        self._memory_type = memory_type
        return self

    def with_after(self, after: str) -> AsyncRecallQuery:
        self._after = after
        return self

    def include_relations(self, include: bool = True) -> AsyncRecallQuery:
        self._include_relations = include
        return self

    async def execute(self) -> RecallResponse:
        if not self._query:
            raise ValueError("Query is required. Use .with_query() to set it.")
        return await self._client.recall(
            self._query,
            limit=self._limit,
            min_similarity=self._min_similarity,
            namespace=self._namespace,
            tags=self._tags,
            session_id=self._session_id,
            agent_id=self._agent_id,
            include_relations=self._include_relations,
            after=self._after,
            memory_type=self._memory_type,
        )


class MemoryFilter:
    """Fluent builder for filtering and iterating over memories.

    Example:
        >>> for memory in (MemoryFilter(client)
        ...     .with_namespace("user-prefs")
        ...     .with_tags(["important"])
        ...     .iter_memories()):
        ...     print(memory.content)
    """

    def __init__(self, client: "MemoClaw") -> None:
        self._client = client
        self._namespace: str | None = None
        self._tags: list[str] | None = None
        self._session_id: str | None = None
        self._agent_id: str | None = None
        self._batch_size: int = 50

    def with_namespace(self, namespace: str) -> MemoryFilter:
        """Filter by namespace."""
        self._namespace = namespace
        return self

    def with_tags(self, tags: list[str]) -> MemoryFilter:
        """Filter by tags."""
        self._tags = tags
        return self

    def with_session_id(self, session_id: str) -> MemoryFilter:
        """Filter by session ID."""
        self._session_id = session_id
        return self

    def with_agent_id(self, agent_id: str) -> MemoryFilter:
        """Filter by agent ID."""
        self._agent_id = agent_id
        return self

    def with_batch_size(self, batch_size: int) -> MemoryFilter:
        """Set batch size for pagination."""
        if batch_size <= 0:
            raise ValueError("batch_size must be positive")
        self._batch_size = batch_size
        return self

    def iter_memories(self) -> Iterator[Memory]:
        """Iterate over all matching memories."""
        yield from self._client.iter_memories(
            namespace=self._namespace,
            tags=self._tags,
            session_id=self._session_id,
            agent_id=self._agent_id,
            batch_size=self._batch_size,
        )

    def list_all(self) -> list[Memory]:
        """Fetch all matching memories at once."""
        return list(self.iter_memories())

    def count(self) -> int:
        """Count matching memories without fetching all data."""
        page = self._client.list(
            limit=1,
            namespace=self._namespace,
            tags=self._tags,
            session_id=self._session_id,
            agent_id=self._agent_id,
        )
        return page.total


class AsyncMemoryFilter:
    """Async version of MemoryFilter."""

    def __init__(self, client: "AsyncMemoClaw") -> None:
        self._client = client
        self._namespace: str | None = None
        self._tags: list[str] | None = None
        self._session_id: str | None = None
        self._agent_id: str | None = None
        self._batch_size: int = 50

    def with_namespace(self, namespace: str) -> AsyncMemoryFilter:
        self._namespace = namespace
        return self

    def with_tags(self, tags: list[str]) -> AsyncMemoryFilter:
        self._tags = tags
        return self

    def with_session_id(self, session_id: str) -> AsyncMemoryFilter:
        self._session_id = session_id
        return self

    def with_agent_id(self, agent_id: str) -> AsyncMemoryFilter:
        self._agent_id = agent_id
        return self

    def with_batch_size(self, batch_size: int) -> AsyncMemoryFilter:
        if batch_size <= 0:
            raise ValueError("batch_size must be positive")
        self._batch_size = batch_size
        return self

    async def iter_memories(self) -> AsyncIterator[Memory]:
        """Iterate over all matching memories."""
        async for memory in self._client.iter_memories(
            namespace=self._namespace,
            tags=self._tags,
            session_id=self._session_id,
            agent_id=self._agent_id,
            batch_size=self._batch_size,
        ):
            yield memory

    async def list_all(self) -> list[Memory]:
        """Fetch all matching memories at once."""
        return [m async for m in self.iter_memories()]

    async def count(self) -> int:
        """Count matching memories without fetching all data."""
        page = await self._client.list(
            limit=1,
            namespace=self._namespace,
            tags=self._tags,
            session_id=self._session_id,
            agent_id=self._agent_id,
        )
        return page.total


class RelationBuilder:
    """Fluent builder for creating and managing memory relations.

    Example:
        >>> relations = (RelationBuilder(client, "memory-123")
        ...     .relate_to("memory-456", "related_to")
        ...     .relate_to("memory-789", "supports")
        ...     .create_all())
    """

    def __init__(self, client: "MemoClaw", source_id: str) -> None:
        self._client = client
        self._source_id = source_id
        self._relations: list[tuple[str, RelationType, dict[str, Any] | None]] = []

    def relate_to(
        self,
        target_id: str,
        relation_type: RelationType,
        metadata: dict[str, Any] | None = None,
    ) -> RelationBuilder:
        """Add a relation to be created."""
        self._relations.append((target_id, relation_type, metadata))
        return self

    def create_all(self) -> list[dict[str, Any]]:
        """Create all pending relations."""
        results = []
        for target_id, relation_type, metadata in self._relations:
            result = self._client.create_relation(
                self._source_id, target_id, relation_type, metadata=metadata
            )
            results.append({
                "id": result.id,
                "target_id": target_id,
                "relation_type": relation_type,
            })
        self._relations.clear()
        return results


class BatchStore:
    """Efficient batch storage with automatic chunking.

    Automatically handles chunking large batches into smaller
    API-friendly sizes.

    Example:
        >>> store = BatchStore(client)
        >>> results = store.add_many(large_memory_list).execute()
    """

    MAX_BATCH_SIZE = 100

    def __init__(self, client: "MemoClaw") -> None:
        self._client = client
        self._memories: list[dict[str, Any]] = []

    def add(
        self,
        content: str,
        *,
        importance: float | None = None,
        tags: list[str] | None = None,
        namespace: str | None = None,
        memory_type: MemoryType | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> BatchStore:
        """Add a memory to the batch."""
        memory: dict[str, Any] = {"content": content}
        if importance is not None:
            memory["importance"] = importance
        if tags is not None:
            memory["tags"] = tags
        if namespace is not None:
            memory["namespace"] = namespace
        if memory_type is not None:
            memory["memory_type"] = memory_type
        if session_id is not None:
            memory["session_id"] = session_id
        if agent_id is not None:
            memory["agent_id"] = agent_id
        if metadata is not None:
            memory["metadata"] = metadata
        self._memories.append(memory)
        return self

    def add_many(self, memories: list[dict[str, Any]]) -> BatchStore:
        """Add multiple memories at once."""
        for mem in memories:
            if isinstance(mem, dict):
                self._memories.append(mem)
        return self

    def count(self) -> int:
        """Return the number of memories in the batch."""
        return len(self._memories)

    def execute(self) -> dict[str, Any]:
        """Execute batch storage, handling automatic chunking."""
        if not self._memories:
            return {"ids": [], "count": 0, "stored": False}

        all_ids: list[str] = []
        total_tokens = 0
        total_deduped = 0

        # Process in chunks
        for i in range(0, len(self._memories), self.MAX_BATCH_SIZE):
            chunk = self._memories[i:i + self.MAX_BATCH_SIZE]
            result = self._client.store_batch(chunk)
            all_ids.extend(result.ids)
            total_tokens += result.tokens_used
            total_deduped += result.deduplicated_count

        self._memories.clear()

        return {
            "ids": all_ids,
            "count": len(all_ids),
            "stored": True,
            "tokens_used": total_tokens,
            "deduplicated_count": total_deduped,
        }


class StoreBuilder:
    """Fluent builder for creating memories before storing.

    Provides a chainable API for constructing memory objects
    before executing the store operation.

    Example:
        >>> from memoclaw import MemoClaw
        >>> from memoclaw.builders import StoreBuilder
        >>>
        >>> client = MemoClaw()
        >>> result = (StoreBuilder(client)
        ...     .content("User prefers dark mode")
        ...     .importance(0.9)
        ...     .tags(["preferences", "ui"])
        ...     .namespace("user-prefs")
        ...     .memory_type("preference")
        ...     .execute())
    """

    def __init__(self, client: "MemoClaw") -> None:
        self._client = client
        self._content: str | None = None
        self._importance: float | None = None
        self._tags: list[str] | None = None
        self._namespace: str | None = None
        self._memory_type: MemoryType | None = None
        self._session_id: str | None = None
        self._agent_id: str | None = None
        self._expires_at: str | None = None
        self._pinned: bool | None = None
        self._metadata: dict[str, Any] | None = None

    def content(self, content: str) -> StoreBuilder:
        """Set the memory content."""
        self._content = content
        return self

    def importance(self, importance: float) -> StoreBuilder:
        """Set importance (0.0 to 1.0)."""
        if not 0.0 <= importance <= 1.0:
            raise ValueError("importance must be between 0.0 and 1.0")
        self._importance = importance
        return self

    def tags(self, tags: list[str]) -> StoreBuilder:
        """Set tags for the memory."""
        self._tags = tags
        return self

    def add_tag(self, tag: str) -> StoreBuilder:
        """Add a single tag."""
        if self._tags is None:
            self._tags = []
        self._tags.append(tag)
        return self

    def namespace(self, namespace: str) -> StoreBuilder:
        """Set namespace."""
        self._namespace = namespace
        return self

    def memory_type(self, memory_type: MemoryType) -> StoreBuilder:
        """Set memory type."""
        self._memory_type = memory_type
        return self

    def session_id(self, session_id: str) -> StoreBuilder:
        """Set session ID."""
        self._session_id = session_id
        return self

    def agent_id(self, agent_id: str) -> StoreBuilder:
        """Set agent ID."""
        self._agent_id = agent_id
        return self

    def expires_at(self, expires_at: str) -> StoreBuilder:
        """Set expiration timestamp (ISO format)."""
        self._expires_at = expires_at
        return self

    def pinned(self, pinned: bool = True) -> StoreBuilder:
        """Pin the memory."""
        self._pinned = pinned
        return self

    def metadata(self, metadata: dict[str, Any]) -> StoreBuilder:
        """Set custom metadata."""
        self._metadata = metadata
        return self

    def execute(self) -> StoreResult:
        """Execute the store operation."""
        if not self._content:
            raise ValueError("Content is required. Use .content() to set it.")
        return self._client.store(
            self._content,
            importance=self._importance,
            tags=self._tags,
            namespace=self._namespace,
            memory_type=self._memory_type,
            session_id=self._session_id,
            agent_id=self._agent_id,
            expires_at=self._expires_at,
            pinned=self._pinned,
            metadata=self._metadata,
        )


class AsyncStoreBuilder:
    """Async version of StoreBuilder."""

    def __init__(self, client: "AsyncMemoClaw") -> None:
        self._client = client
        self._content: str | None = None
        self._importance: float | None = None
        self._tags: list[str] | None = None
        self._namespace: str | None = None
        self._memory_type: MemoryType | None = None
        self._session_id: str | None = None
        self._agent_id: str | None = None
        self._expires_at: str | None = None
        self._pinned: bool | None = None
        self._metadata: dict[str, Any] | None = None

    def content(self, content: str) -> AsyncStoreBuilder:
        self._content = content
        return self

    def importance(self, importance: float) -> AsyncStoreBuilder:
        if not 0.0 <= importance <= 1.0:
            raise ValueError("importance must be between 0.0 and 1.0")
        self._importance = importance
        return self

    def tags(self, tags: list[str]) -> AsyncStoreBuilder:
        self._tags = tags
        return self

    def add_tag(self, tag: str) -> AsyncStoreBuilder:
        if self._tags is None:
            self._tags = []
        self._tags.append(tag)
        return self

    def namespace(self, namespace: str) -> AsyncStoreBuilder:
        self._namespace = namespace
        return self

    def memory_type(self, memory_type: MemoryType) -> AsyncStoreBuilder:
        self._memory_type = memory_type
        return self

    def session_id(self, session_id: str) -> AsyncStoreBuilder:
        self._session_id = session_id
        return self

    def agent_id(self, agent_id: str) -> AsyncStoreBuilder:
        self._agent_id = agent_id
        return self

    def expires_at(self, expires_at: str) -> AsyncStoreBuilder:
        self._expires_at = expires_at
        return self

    def pinned(self, pinned: bool = True) -> AsyncStoreBuilder:
        self._pinned = pinned
        return self

    def metadata(self, metadata: dict[str, Any]) -> AsyncStoreBuilder:
        self._metadata = metadata
        return self

    async def execute(self) -> StoreResult:
        if not self._content:
            raise ValueError("Content is required. Use .content() to set it.")
        return await self._client.store(
            self._content,
            importance=self._importance,
            tags=self._tags,
            namespace=self._namespace,
            memory_type=self._memory_type,
            session_id=self._session_id,
            agent_id=self._agent_id,
            expires_at=self._expires_at,
            pinned=self._pinned,
            metadata=self._metadata,
        )


__all__ = [
    "MemoryBuilder",
    "RecallBuilder",
    "RecallQuery",
    "AsyncRecallQuery",
    "MemoryFilter",
    "AsyncMemoryFilter",
    "RelationBuilder",
    "BatchStore",
    "StoreBuilder",
    "AsyncStoreBuilder",
]
