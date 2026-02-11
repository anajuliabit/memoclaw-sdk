"""User-facing MemoClaw and AsyncMemoClaw client classes."""

from __future__ import annotations

import os
from typing import Any

from ._client import DEFAULT_BASE_URL, DEFAULT_TIMEOUT, _AsyncHTTPClient, _SyncHTTPClient
from .types import (
    ConsolidateResult,
    DeleteResult,
    ExtractResult,
    FreeTierStatus,
    IngestResult,
    ListResponse,
    Memory,
    MemoryType,
    Message,
    RecallResponse,
    Relation,
    RelationsResponse,
    RelationType,
    StoreBatchResult,
    StoreInput,
    StoreResult,
    SuggestedCategory,
    SuggestedResponse,
)


def _get_private_key(private_key: str | None) -> str:
    if private_key is not None:
        return private_key
    env_key = os.environ.get("MEMOCLAW_PRIVATE_KEY")
    if env_key:
        return env_key
    raise ValueError(
        "No private key provided. Pass private_key= or set MEMOCLAW_PRIVATE_KEY."
    )


def _clean_params(params: dict[str, Any]) -> dict[str, Any]:
    """Remove None values and convert lists to comma-separated strings."""
    cleaned: dict[str, Any] = {}
    for k, v in params.items():
        if v is None:
            continue
        if isinstance(v, list):
            cleaned[k] = ",".join(str(i) for i in v)
        elif isinstance(v, bool):
            cleaned[k] = str(v).lower()
        else:
            cleaned[k] = v
    return cleaned


def _clean_body(body: dict[str, Any]) -> dict[str, Any]:
    """Remove None values from a request body."""
    return {k: v for k, v in body.items() if v is not None}


def _build_store_body(
    content: str,
    *,
    importance: float | None,
    tags: list[str] | None,
    namespace: str | None,
    memory_type: MemoryType | None,
    session_id: str | None,
    agent_id: str | None,
    expires_at: str | None,
    metadata: dict[str, Any] | None,
) -> dict[str, Any]:
    body: dict[str, Any] = {"content": content}
    if importance is not None:
        body["importance"] = importance
    if namespace is not None:
        body["namespace"] = namespace
    if memory_type is not None:
        body["memory_type"] = memory_type
    if session_id is not None:
        body["session_id"] = session_id
    if agent_id is not None:
        body["agent_id"] = agent_id
    if expires_at is not None:
        body["expires_at"] = expires_at
    if tags is not None or metadata is not None:
        md: dict[str, Any] = metadata.copy() if metadata else {}
        if tags is not None:
            md["tags"] = tags
        body["metadata"] = md
    return body


class MemoClaw:
    """Synchronous MemoClaw client.

    Args:
        private_key: Ethereum private key for wallet auth.
            Falls back to ``MEMOCLAW_PRIVATE_KEY`` env var.
        base_url: API base URL. Defaults to ``https://api.memoclaw.com``.
        timeout: Request timeout in seconds. Defaults to 30.
    """

    def __init__(
        self,
        private_key: str | None = None,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
    ) -> None:
        self._http = _SyncHTTPClient(
            private_key=_get_private_key(private_key),
            base_url=base_url,
            timeout=timeout,
        )

    # ── Context manager ──────────────────────────────────────────────────

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> MemoClaw:
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()

    # ── Store ────────────────────────────────────────────────────────────

    def store(
        self,
        content: str,
        *,
        importance: float | None = None,
        tags: list[str] | None = None,
        namespace: str | None = None,
        memory_type: MemoryType | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
        expires_at: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> StoreResult:
        """Store a memory."""
        body = _build_store_body(
            content,
            importance=importance,
            tags=tags,
            namespace=namespace,
            memory_type=memory_type,
            session_id=session_id,
            agent_id=agent_id,
            expires_at=expires_at,
            metadata=metadata,
        )
        data = self._http.request("POST", "/v1/store", json=body)
        return StoreResult.model_validate(data)

    def store_batch(
        self,
        memories: list[StoreInput | dict[str, Any]],
    ) -> StoreBatchResult:
        """Store up to 100 memories at once."""
        items = [
            m.model_dump(exclude_none=True) if isinstance(m, StoreInput) else m
            for m in memories
        ]
        data = self._http.request("POST", "/v1/store/batch", json={"memories": items})
        return StoreBatchResult.model_validate(data)

    # ── Recall ───────────────────────────────────────────────────────────

    def recall(
        self,
        query: str,
        *,
        limit: int | None = None,
        min_similarity: float | None = None,
        namespace: str | None = None,
        tags: list[str] | None = None,
        include_relations: bool | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
        after: str | None = None,
    ) -> RecallResponse:
        """Semantic recall of memories matching a query."""
        body: dict[str, Any] = {"query": query}
        if limit is not None:
            body["limit"] = limit
        if min_similarity is not None:
            body["min_similarity"] = min_similarity
        if namespace is not None:
            body["namespace"] = namespace
        if session_id is not None:
            body["session_id"] = session_id
        if agent_id is not None:
            body["agent_id"] = agent_id
        if include_relations is not None:
            body["include_relations"] = include_relations
        if tags is not None or after is not None:
            filters: dict[str, Any] = {}
            if tags is not None:
                filters["tags"] = tags
            if after is not None:
                filters["after"] = after
            body["filters"] = filters

        data = self._http.request("POST", "/v1/recall", json=body)
        return RecallResponse.model_validate(data)

    # ── List ─────────────────────────────────────────────────────────────

    def list(
        self,
        *,
        limit: int | None = None,
        offset: int | None = None,
        namespace: str | None = None,
        tags: list[str] | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
    ) -> ListResponse:
        """List memories with pagination."""
        params = _clean_params(
            {
                "limit": limit,
                "offset": offset,
                "namespace": namespace,
                "tags": tags,
                "session_id": session_id,
                "agent_id": agent_id,
            }
        )
        data = self._http.request("GET", "/v1/memories", params=params)
        return ListResponse.model_validate(data)

    # ── Update ───────────────────────────────────────────────────────────

    def update(
        self,
        memory_id: str,
        *,
        content: str | None = None,
        metadata: dict[str, Any] | None = None,
        importance: float | None = None,
        memory_type: MemoryType | None = None,
        namespace: str | None = None,
        expires_at: str | None = ...,  # type: ignore[assignment]
    ) -> Memory:
        """Update a memory by ID. Only provided fields are updated."""
        body: dict[str, Any] = {}
        if content is not None:
            body["content"] = content
        if metadata is not None:
            body["metadata"] = metadata
        if importance is not None:
            body["importance"] = importance
        if memory_type is not None:
            body["memory_type"] = memory_type
        if namespace is not None:
            body["namespace"] = namespace
        # expires_at uses sentinel so users can pass None to clear it
        if expires_at is not ...:
            body["expires_at"] = expires_at

        data = self._http.request("PATCH", f"/v1/memories/{memory_id}", json=body)
        return Memory.model_validate(data)

    # ── Delete ───────────────────────────────────────────────────────────

    def delete(self, memory_id: str) -> DeleteResult:
        """Delete a memory by ID."""
        data = self._http.request("DELETE", f"/v1/memories/{memory_id}")
        return DeleteResult.model_validate(data)

    # ── Ingest ───────────────────────────────────────────────────────────

    def ingest(
        self,
        *,
        messages: list[Message | dict[str, str]] | None = None,
        text: str | None = None,
        namespace: str | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
        auto_relate: bool | None = None,
    ) -> IngestResult:
        """Auto-extract and store facts from conversation or text."""
        body: dict[str, Any] = {}
        if messages is not None:
            body["messages"] = [
                m.model_dump() if isinstance(m, Message) else m for m in messages
            ]
        if text is not None:
            body["text"] = text
        if namespace is not None:
            body["namespace"] = namespace
        if session_id is not None:
            body["session_id"] = session_id
        if agent_id is not None:
            body["agent_id"] = agent_id
        if auto_relate is not None:
            body["auto_relate"] = auto_relate

        data = self._http.request("POST", "/v1/ingest", json=body)
        return IngestResult.model_validate(data)

    # ── Extract ──────────────────────────────────────────────────────────

    def extract(
        self,
        messages: list[Message | dict[str, str]],
        *,
        namespace: str | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
    ) -> ExtractResult:
        """Extract structured facts from conversation via LLM."""
        body: dict[str, Any] = {
            "messages": [
                m.model_dump() if isinstance(m, Message) else m for m in messages
            ]
        }
        if namespace is not None:
            body["namespace"] = namespace
        if session_id is not None:
            body["session_id"] = session_id
        if agent_id is not None:
            body["agent_id"] = agent_id

        data = self._http.request("POST", "/v1/memories/extract", json=body)
        return ExtractResult.model_validate(data)

    # ── Consolidate ──────────────────────────────────────────────────────

    def consolidate(
        self,
        *,
        namespace: str | None = None,
        min_similarity: float | None = None,
        mode: str | None = None,
        dry_run: bool | None = None,
    ) -> ConsolidateResult:
        """Merge similar memories by clustering."""
        body = _clean_body(
            {
                "namespace": namespace,
                "min_similarity": min_similarity,
                "mode": mode,
                "dry_run": dry_run,
            }
        )
        data = self._http.request("POST", "/v1/memories/consolidate", json=body)
        return ConsolidateResult.model_validate(data)

    # ── Suggested ────────────────────────────────────────────────────────

    def suggested(
        self,
        *,
        limit: int | None = None,
        namespace: str | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
        category: SuggestedCategory | None = None,
    ) -> SuggestedResponse:
        """Get proactive memory suggestions."""
        params = _clean_params(
            {
                "limit": limit,
                "namespace": namespace,
                "session_id": session_id,
                "agent_id": agent_id,
                "category": category,
            }
        )
        data = self._http.request("GET", "/v1/suggested", params=params)
        return SuggestedResponse.model_validate(data)

    # ── Relations ────────────────────────────────────────────────────────

    def create_relation(
        self,
        memory_id: str,
        target_id: str,
        relation_type: RelationType,
        *,
        metadata: dict[str, Any] | None = None,
    ) -> Relation:
        """Create a relationship between two memories."""
        body: dict[str, Any] = {
            "target_id": target_id,
            "relation_type": relation_type,
        }
        if metadata is not None:
            body["metadata"] = metadata
        data = self._http.request(
            "POST", f"/v1/memories/{memory_id}/relations", json=body
        )
        return Relation.model_validate(data)

    def list_relations(self, memory_id: str) -> list[RelationsResponse]:
        """List all relationships for a memory."""
        data = self._http.request("GET", f"/v1/memories/{memory_id}/relations")
        resp = RelationsResponse.model_validate(data)
        return resp.relations  # type: ignore[return-value]

    def delete_relation(self, memory_id: str, relation_id: str) -> DeleteResult:
        """Delete a memory relationship."""
        data = self._http.request(
            "DELETE", f"/v1/memories/{memory_id}/relations/{relation_id}"
        )
        return DeleteResult.model_validate(data)

    # ── Status ───────────────────────────────────────────────────────────

    def status(self) -> FreeTierStatus:
        """Check free tier remaining calls."""
        data = self._http.request("GET", "/v1/free-tier/status")
        return FreeTierStatus.model_validate(data)


class AsyncMemoClaw:
    """Asynchronous MemoClaw client.

    Args:
        private_key: Ethereum private key for wallet auth.
            Falls back to ``MEMOCLAW_PRIVATE_KEY`` env var.
        base_url: API base URL. Defaults to ``https://api.memoclaw.com``.
        timeout: Request timeout in seconds. Defaults to 30.
    """

    def __init__(
        self,
        private_key: str | None = None,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
    ) -> None:
        self._http = _AsyncHTTPClient(
            private_key=_get_private_key(private_key),
            base_url=base_url,
            timeout=timeout,
        )

    # ── Context manager ──────────────────────────────────────────────────

    async def close(self) -> None:
        await self._http.close()

    async def __aenter__(self) -> AsyncMemoClaw:
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.close()

    # ── Store ────────────────────────────────────────────────────────────

    async def store(
        self,
        content: str,
        *,
        importance: float | None = None,
        tags: list[str] | None = None,
        namespace: str | None = None,
        memory_type: MemoryType | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
        expires_at: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> StoreResult:
        """Store a memory."""
        body = _build_store_body(
            content,
            importance=importance,
            tags=tags,
            namespace=namespace,
            memory_type=memory_type,
            session_id=session_id,
            agent_id=agent_id,
            expires_at=expires_at,
            metadata=metadata,
        )
        data = await self._http.request("POST", "/v1/store", json=body)
        return StoreResult.model_validate(data)

    async def store_batch(
        self,
        memories: list[StoreInput | dict[str, Any]],
    ) -> StoreBatchResult:
        """Store up to 100 memories at once."""
        items = [
            m.model_dump(exclude_none=True) if isinstance(m, StoreInput) else m
            for m in memories
        ]
        data = await self._http.request(
            "POST", "/v1/store/batch", json={"memories": items}
        )
        return StoreBatchResult.model_validate(data)

    # ── Recall ───────────────────────────────────────────────────────────

    async def recall(
        self,
        query: str,
        *,
        limit: int | None = None,
        min_similarity: float | None = None,
        namespace: str | None = None,
        tags: list[str] | None = None,
        include_relations: bool | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
        after: str | None = None,
    ) -> RecallResponse:
        """Semantic recall of memories matching a query."""
        body: dict[str, Any] = {"query": query}
        if limit is not None:
            body["limit"] = limit
        if min_similarity is not None:
            body["min_similarity"] = min_similarity
        if namespace is not None:
            body["namespace"] = namespace
        if session_id is not None:
            body["session_id"] = session_id
        if agent_id is not None:
            body["agent_id"] = agent_id
        if include_relations is not None:
            body["include_relations"] = include_relations
        if tags is not None or after is not None:
            filters: dict[str, Any] = {}
            if tags is not None:
                filters["tags"] = tags
            if after is not None:
                filters["after"] = after
            body["filters"] = filters

        data = await self._http.request("POST", "/v1/recall", json=body)
        return RecallResponse.model_validate(data)

    # ── List ─────────────────────────────────────────────────────────────

    async def list(
        self,
        *,
        limit: int | None = None,
        offset: int | None = None,
        namespace: str | None = None,
        tags: list[str] | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
    ) -> ListResponse:
        """List memories with pagination."""
        params = _clean_params(
            {
                "limit": limit,
                "offset": offset,
                "namespace": namespace,
                "tags": tags,
                "session_id": session_id,
                "agent_id": agent_id,
            }
        )
        data = await self._http.request("GET", "/v1/memories", params=params)
        return ListResponse.model_validate(data)

    # ── Update ───────────────────────────────────────────────────────────

    async def update(
        self,
        memory_id: str,
        *,
        content: str | None = None,
        metadata: dict[str, Any] | None = None,
        importance: float | None = None,
        memory_type: MemoryType | None = None,
        namespace: str | None = None,
        expires_at: str | None = ...,  # type: ignore[assignment]
    ) -> Memory:
        """Update a memory by ID. Only provided fields are updated."""
        body: dict[str, Any] = {}
        if content is not None:
            body["content"] = content
        if metadata is not None:
            body["metadata"] = metadata
        if importance is not None:
            body["importance"] = importance
        if memory_type is not None:
            body["memory_type"] = memory_type
        if namespace is not None:
            body["namespace"] = namespace
        if expires_at is not ...:
            body["expires_at"] = expires_at

        data = await self._http.request(
            "PATCH", f"/v1/memories/{memory_id}", json=body
        )
        return Memory.model_validate(data)

    # ── Delete ───────────────────────────────────────────────────────────

    async def delete(self, memory_id: str) -> DeleteResult:
        """Delete a memory by ID."""
        data = await self._http.request("DELETE", f"/v1/memories/{memory_id}")
        return DeleteResult.model_validate(data)

    # ── Ingest ───────────────────────────────────────────────────────────

    async def ingest(
        self,
        *,
        messages: list[Message | dict[str, str]] | None = None,
        text: str | None = None,
        namespace: str | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
        auto_relate: bool | None = None,
    ) -> IngestResult:
        """Auto-extract and store facts from conversation or text."""
        body: dict[str, Any] = {}
        if messages is not None:
            body["messages"] = [
                m.model_dump() if isinstance(m, Message) else m for m in messages
            ]
        if text is not None:
            body["text"] = text
        if namespace is not None:
            body["namespace"] = namespace
        if session_id is not None:
            body["session_id"] = session_id
        if agent_id is not None:
            body["agent_id"] = agent_id
        if auto_relate is not None:
            body["auto_relate"] = auto_relate

        data = await self._http.request("POST", "/v1/ingest", json=body)
        return IngestResult.model_validate(data)

    # ── Extract ──────────────────────────────────────────────────────────

    async def extract(
        self,
        messages: list[Message | dict[str, str]],
        *,
        namespace: str | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
    ) -> ExtractResult:
        """Extract structured facts from conversation via LLM."""
        body: dict[str, Any] = {
            "messages": [
                m.model_dump() if isinstance(m, Message) else m for m in messages
            ]
        }
        if namespace is not None:
            body["namespace"] = namespace
        if session_id is not None:
            body["session_id"] = session_id
        if agent_id is not None:
            body["agent_id"] = agent_id

        data = await self._http.request("POST", "/v1/memories/extract", json=body)
        return ExtractResult.model_validate(data)

    # ── Consolidate ──────────────────────────────────────────────────────

    async def consolidate(
        self,
        *,
        namespace: str | None = None,
        min_similarity: float | None = None,
        mode: str | None = None,
        dry_run: bool | None = None,
    ) -> ConsolidateResult:
        """Merge similar memories by clustering."""
        body = _clean_body(
            {
                "namespace": namespace,
                "min_similarity": min_similarity,
                "mode": mode,
                "dry_run": dry_run,
            }
        )
        data = await self._http.request(
            "POST", "/v1/memories/consolidate", json=body
        )
        return ConsolidateResult.model_validate(data)

    # ── Suggested ────────────────────────────────────────────────────────

    async def suggested(
        self,
        *,
        limit: int | None = None,
        namespace: str | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
        category: SuggestedCategory | None = None,
    ) -> SuggestedResponse:
        """Get proactive memory suggestions."""
        params = _clean_params(
            {
                "limit": limit,
                "namespace": namespace,
                "session_id": session_id,
                "agent_id": agent_id,
                "category": category,
            }
        )
        data = await self._http.request("GET", "/v1/suggested", params=params)
        return SuggestedResponse.model_validate(data)

    # ── Relations ────────────────────────────────────────────────────────

    async def create_relation(
        self,
        memory_id: str,
        target_id: str,
        relation_type: RelationType,
        *,
        metadata: dict[str, Any] | None = None,
    ) -> Relation:
        """Create a relationship between two memories."""
        body: dict[str, Any] = {
            "target_id": target_id,
            "relation_type": relation_type,
        }
        if metadata is not None:
            body["metadata"] = metadata
        data = await self._http.request(
            "POST", f"/v1/memories/{memory_id}/relations", json=body
        )
        return Relation.model_validate(data)

    async def list_relations(self, memory_id: str) -> list[RelationsResponse]:
        """List all relationships for a memory."""
        data = await self._http.request(
            "GET", f"/v1/memories/{memory_id}/relations"
        )
        resp = RelationsResponse.model_validate(data)
        return resp.relations  # type: ignore[return-value]

    async def delete_relation(
        self, memory_id: str, relation_id: str
    ) -> DeleteResult:
        """Delete a memory relationship."""
        data = await self._http.request(
            "DELETE", f"/v1/memories/{memory_id}/relations/{relation_id}"
        )
        return DeleteResult.model_validate(data)

    # ── Status ───────────────────────────────────────────────────────────

    async def status(self) -> FreeTierStatus:
        """Check free tier remaining calls."""
        data = await self._http.request("GET", "/v1/free-tier/status")
        return FreeTierStatus.model_validate(data)
