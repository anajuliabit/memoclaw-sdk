"""Fluent builder patterns for MemoClaw SDK."""

from __future__ import annotations

from typing import Any

from .types import MemoryType, StoreInput


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


__all__ = ["MemoryBuilder", "RecallBuilder"]
