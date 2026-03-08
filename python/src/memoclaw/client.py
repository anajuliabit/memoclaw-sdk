"""User-facing MemoClaw and AsyncMemoClaw client classes."""

from __future__ import annotations

from pathlib import Path
from types import EllipsisType
from urllib.parse import quote

from collections.abc import AsyncIterator, Callable, Iterator, Sequence

from typing import Any

# Preserve built-in ``list`` reference — the ``list()`` method on client
# classes shadows the built-in within their class scope, confusing mypy.
_list = list

from ._client import (
    DEFAULT_BASE_URL,
    DEFAULT_POOL_MAX_CONNECTIONS,
    DEFAULT_POOL_MAX_KEEPALIVE_CONNECTIONS,
    DEFAULT_TIMEOUT,
    _AsyncHTTPClient,
    _SyncHTTPClient,
)
from .builders import StoreBuilder, AsyncStoreBuilder
from .config import load_config, resolve_base_url, resolve_private_key, resolve_wallet_address
from .types import (
    ConsolidateResult,
    ContextResult,
    CoreMemoriesResponse,
    DeleteBatchItemResult,
    DeleteResult,
    ExportResponse,
    ExtractResult,
    FreeTierStatus,
    HistoryEntry,
    HistoryResponse,
    IngestResult,
    ListResponse,
    Memory,
    MemoryType,
    MigrateResult,
    Message,
    NamespacesResponse,
    RecallResponse,
    Relation,
    RelationWithMemory,
    RelationsResponse,
    RelationType,
    StatsResponse,
    StoreBatchResult,
    StoreInput,
    StoreResult,
    SuggestedCategory,
    SuggestedResponse,
    TextSearchResponse,
    UpdateBatchResult,
    UpdateInput,
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


MAX_BATCH_SIZE = 100


def _normalize_store_input(m: StoreInput) -> dict[str, Any]:
    """Serialize a StoreInput, nesting ``tags`` inside ``metadata`` to match the API schema."""
    data = m.model_dump(exclude_none=True)
    tags = data.pop("tags", None)
    if tags is not None:
        md: dict[str, Any] = data.get("metadata") or {}
        md["tags"] = tags
        data["metadata"] = md
    return data


def _validate_non_empty(value: str | None, name: str) -> None:
    """Raise ValueError if value is empty or whitespace-only."""
    if not value or not value.strip():
        raise ValueError(f"{name} must be a non-empty string")


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
    pinned: bool | None,
    immutable: bool | None,
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
    if pinned is not None:
        body["pinned"] = pinned
    if immutable is not None:
        body["immutable"] = immutable
    if tags is not None or metadata is not None:
        md: dict[str, Any] = metadata.copy() if metadata else {}
        if tags is not None:
            md["tags"] = tags
        body["metadata"] = md
    return body


# ── Middleware / Hooks ────────────────────────────────────────────────────────

# Hook signatures:
#   before_request(method: str, path: str, body: dict | None) -> dict | None
#   after_response(method: str, path: str, result: Any) -> Any
#   on_error(method: str, path: str, error: Exception) -> None

BeforeRequestHook = Callable[[str, str, dict[str, Any] | None], dict[str, Any] | None]
AfterResponseHook = Callable[[str, str, Any], Any]
OnErrorHook = Callable[[str, str, Exception], None]


class MemoClaw:
    """Synchronous MemoClaw client.

    Args:
        private_key: Ethereum private key for wallet auth.
            Falls back to ``MEMOCLAW_PRIVATE_KEY`` env var.
        wallet_address: Ethereum wallet address for read-only access to free
            endpoints.  When only a wallet address is provided (no private key),
            the client operates in *wallet-only* mode — signed requests are not
            available, but all free endpoints (list, get, delete, stats, …) work.
            Falls back to ``MEMOCLAW_WALLET`` env var.
        base_url: API base URL. Defaults to ``https://api.memoclaw.com``.
        timeout: Request timeout in seconds. Defaults to 30.
        max_retries: Maximum retry attempts for transient errors. Defaults to 2.
        pool_max_connections: Maximum number of connections in the pool. Defaults to 10.
        pool_max_keepalive: Maximum number of keep-alive connections. Defaults to 5.
    """

    def __init__(
        self,
        private_key: str | None = None,
        *,
        wallet_address: str | None = None,
        base_url: str | None = None,
        timeout: float = DEFAULT_TIMEOUT,
        max_retries: int | None = None,
        pool_max_connections: int = DEFAULT_POOL_MAX_CONNECTIONS,
        pool_max_keepalive: int = DEFAULT_POOL_MAX_KEEPALIVE_CONNECTIONS,
        config_path: str | Path | None = None,
    ) -> None:
        config = load_config(config_path)
        resolved_url = resolve_base_url(base_url, config)
        resolved_wallet = resolve_wallet_address(wallet_address, config)
        resolved_key = resolve_private_key(private_key, config, wallet_address=resolved_wallet)

        if resolved_key is None and resolved_wallet is None:
            raise ValueError(
                "No authentication provided. Pass private_key= or wallet_address=, "
                "set MEMOCLAW_PRIVATE_KEY / MEMOCLAW_WALLET, "
                "or run `memoclaw init` to create ~/.memoclaw/config.json."
            )

        kwargs: dict[str, Any] = {
            "base_url": resolved_url,
            "timeout": timeout,
            "pool_max_connections": pool_max_connections,
            "pool_max_keepalive": pool_max_keepalive,
        }
        if resolved_key is not None:
            kwargs["private_key"] = resolved_key
        else:
            kwargs["wallet_address"] = resolved_wallet
        if max_retries is not None:
            kwargs["max_retries"] = max_retries
        self._http = _SyncHTTPClient(**kwargs)
        self._before_request_hooks: _list[BeforeRequestHook] = []
        self._after_response_hooks: _list[AfterResponseHook] = []
        self._on_error_hooks: _list[OnErrorHook] = []

    # ── Auth helpers ────────────────────────────────────────────────────

    def _require_signed_auth(self, method_name: str) -> None:
        """Raise if the client is in wallet-only mode (no private key).

        Paid endpoints require cryptographic signature auth. This gives a
        clear client-side error instead of a confusing server 401/403.
        """
        if self._http._account is None:
            raise ValueError(
                f"{method_name}() requires a private key for signed authentication. "
                "Pass private_key= option, set MEMOCLAW_PRIVATE_KEY, "
                "or run `memoclaw init`."
            )

    # ── Hooks API ────────────────────────────────────────────────────────

    def on_before_request(self, hook: BeforeRequestHook) -> MemoClaw:
        """Register a hook called before each request. Returns self for chaining."""
        self._before_request_hooks.append(hook)
        return self

    def on_after_response(self, hook: AfterResponseHook) -> MemoClaw:
        """Register a hook called after each successful response. Returns self for chaining."""
        self._after_response_hooks.append(hook)
        return self

    def on_error(self, hook: OnErrorHook) -> MemoClaw:
        """Register a hook called on errors. Returns self for chaining."""
        self._on_error_hooks.append(hook)
        return self

    def _run_request(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
        timeout: float | None = None,
    ) -> Any:
        """Internal request wrapper that invokes hooks.

        Args:
            timeout: Per-request timeout in seconds. Overrides the client default.
        """
        body = json
        for before_hook in self._before_request_hooks:
            result = before_hook(method, path, body)
            if result is not None:
                body = result
        try:
            data = self._http.request(method, path, json=body, params=params, timeout=timeout)
        except Exception as exc:
            for error_hook in self._on_error_hooks:
                error_hook(method, path, exc)
            raise
        for after_hook in self._after_response_hooks:
            transformed = after_hook(method, path, data)
            if transformed is not None:
                data = transformed
        return data

    # ── Representation ───────────────────────────────────────────────────

    def __repr__(self) -> str:
        wallet = self._http._wallet_address
        truncated = f"{wallet[:6]}...{wallet[-4:]}" if len(wallet) > 10 else wallet
        mode = "signed" if self._http._account is not None else "wallet-only"
        return f"MemoClaw(base_url={self._http._base_url!r}, wallet={truncated!r}, mode={mode!r})"

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
        tags: _list[str] | None = None,
        namespace: str | None = None,
        memory_type: MemoryType | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
        expires_at: str | None = None,
        pinned: bool | None = None,
        immutable: bool | None = None,
        metadata: dict[str, Any] | None = None,
        timeout: float | None = None,
    ) -> StoreResult:
        """Store a memory.

        Args:
            timeout: Per-request timeout in seconds. Overrides the client default.
        """
        self._require_signed_auth("store")
        _validate_non_empty(content, "content")
        body = _build_store_body(
            content,
            importance=importance,
            tags=tags,
            namespace=namespace,
            memory_type=memory_type,
            session_id=session_id,
            agent_id=agent_id,
            expires_at=expires_at,
            pinned=pinned,
            immutable=immutable,
            metadata=metadata,
        )
        data = self._run_request("POST", "/v1/store", json=body, timeout=timeout)
        return StoreResult.model_validate(data)

    def store_batch(
        self,
        memories: Sequence[StoreInput | dict[str, Any]],
        *,
        timeout: float | None = None,
    ) -> StoreBatchResult:
        """Store up to 100 memories at once.

        Args:
            timeout: Per-request timeout in seconds. Overrides the client default.
        """
        self._require_signed_auth("store_batch")
        if not memories:
            raise ValueError("memories list must not be empty")
        if len(memories) > MAX_BATCH_SIZE:
            raise ValueError(
                f"Batch size {len(memories)} exceeds maximum of {MAX_BATCH_SIZE}"
            )
        items = [
            _normalize_store_input(m) if isinstance(m, StoreInput) else m
            for m in memories
        ]
        data = self._run_request("POST", "/v1/store/batch", json={"memories": items}, timeout=timeout)
        return StoreBatchResult.model_validate(data)

    def store_builder(self) -> StoreBuilder:
        """Create a StoreBuilder for fluent memory creation.

        Example:
            >>> result = (client.store_builder()
            ...     .content("User prefers dark mode")
            ...     .importance(0.9)
            ...     .tags(["preferences"])
            ...     .execute())
        """
        return StoreBuilder(self)

    # ── Recall ───────────────────────────────────────────────────────────

    def recall(
        self,
        query: str,
        *,
        limit: int | None = None,
        min_similarity: float | None = None,
        namespace: str | None = None,
        tags: _list[str] | None = None,
        include_relations: bool | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
        after: str | None = None,
        memory_type: MemoryType | None = None,
        timeout: float | None = None,
    ) -> RecallResponse:
        """Semantic recall of memories matching a query."""
        self._require_signed_auth("recall")
        _validate_non_empty(query, "query")
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
        if tags is not None or after is not None or memory_type is not None:
            filters: dict[str, Any] = {}
            if tags is not None:
                filters["tags"] = tags
            if after is not None:
                filters["after"] = after
            if memory_type is not None:
                filters["memory_type"] = memory_type
            body["filters"] = filters

        data = self._run_request("POST", "/v1/recall", json=body, timeout=timeout)
        return RecallResponse.model_validate(data)

    # ── List ─────────────────────────────────────────────────────────────

    def list(
        self,
        *,
        limit: int | None = None,
        offset: int | None = None,
        namespace: str | None = None,
        tags: _list[str] | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
        memory_type: MemoryType | None = None,
        before: str | None = None,
        after: str | None = None,
        include_deleted: bool | None = None,
        timeout: float | None = None,
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
                "memory_type": memory_type,
                "before": before,
                "after": after,
                "include_deleted": include_deleted,
            }
        )
        data = self._run_request("GET", "/v1/memories", params=params, timeout=timeout)
        return ListResponse.model_validate(data)

    def iter_memories(
        self,
        *,
        batch_size: int = 50,
        namespace: str | None = None,
        tags: _list[str] | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
        memory_type: MemoryType | None = None,
        before: str | None = None,
        after: str | None = None,
        include_deleted: bool | None = None,
    ) -> Iterator[Memory]:
        """Iterate over all memories with automatic pagination.

        Yields individual :class:`Memory` objects, fetching pages transparently.
        Supports all the same filters as :meth:`list`.
        """
        offset = 0
        while True:
            page = self.list(
                limit=batch_size,
                offset=offset,
                namespace=namespace,
                tags=tags,
                session_id=session_id,
                agent_id=agent_id,
                memory_type=memory_type,
                before=before,
                after=after,
                include_deleted=include_deleted,
            )
            yield from page.memories
            offset += len(page.memories)
            if offset >= page.total or not page.memories:
                break

    # ── Get ──────────────────────────────────────────────────────────────

    def get(self, memory_id: str, *, timeout: float | None = None) -> Memory:
        """Retrieve a single memory by ID."""
        _validate_non_empty(memory_id, "memory_id")
        data = self._run_request("GET", f"/v1/memories/{quote(memory_id, safe='')}", timeout=timeout)
        return Memory.model_validate(data)

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
        pinned: bool | None = None,
        immutable: bool | None = None,
        expires_at: str | None | EllipsisType = ...,
        timeout: float | None = None,
    ) -> Memory:
        """Update a memory by ID. Only provided fields are updated.

        Args:
            timeout: Per-request timeout in seconds. Overrides the client default.
        """
        self._require_signed_auth("update")
        _validate_non_empty(memory_id, "memory_id")
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
        if pinned is not None:
            body["pinned"] = pinned
        if immutable is not None:
            body["immutable"] = immutable
        # expires_at uses sentinel so users can pass None to clear it
        if expires_at is not ...:
            body["expires_at"] = expires_at

        data = self._run_request("PATCH", f"/v1/memories/{quote(memory_id, safe='')}", json=body, timeout=timeout)
        return Memory.model_validate(data)

    # ── Batch Update ─────────────────────────────────────────────────────

    def update_batch(
        self,
        updates: _list[UpdateInput | dict[str, Any]],
        *,
        timeout: float | None = None,
    ) -> UpdateBatchResult:
        """Update multiple memories in a single request.

        Each update must include an ``id`` and at least one field to change.

        Args:
            updates: List of :class:`UpdateInput` or dicts with ``id`` plus fields to update.

        Example::

            result = client.update_batch([
                {"id": "mem-1", "importance": 0.9},
                {"id": "mem-2", "content": "Updated content", "pinned": True},
            ])
        """
        self._require_signed_auth("update_batch")
        if not updates:
            raise ValueError("updates list must not be empty")
        if len(updates) > MAX_BATCH_SIZE:
            raise ValueError(
                f"Batch size {len(updates)} exceeds maximum of {MAX_BATCH_SIZE}"
            )
        items = [
            u.model_dump(exclude_none=True) if isinstance(u, UpdateInput) else u
            for u in updates
        ]
        for item in items:
            if "id" not in item or not item["id"]:
                raise ValueError("Each update must include a non-empty 'id'")
        data = self._run_request(
            "POST", "/v1/memories/batch-update", json={"updates": items}, timeout=timeout
        )
        return UpdateBatchResult.model_validate(data)

    # ── Delete ───────────────────────────────────────────────────────────

    def delete(self, memory_id: str, *, timeout: float | None = None) -> DeleteResult:
        """Delete a memory by ID."""
        _validate_non_empty(memory_id, "memory_id")
        data = self._run_request("DELETE", f"/v1/memories/{quote(memory_id, safe='')}", timeout=timeout)
        return DeleteResult.model_validate(data)

    def delete_batch(self, memory_ids: _list[str], *, timeout: float | None = None) -> _list[DeleteBatchItemResult]:
        """Delete multiple memories by ID using the batch endpoint.

        Processes in chunks of 50 for API compatibility.
        Returns a list of :class:`DeleteBatchItemResult` objects.
        """
        if not memory_ids:
            return []
        results: _list[DeleteBatchItemResult] = []
        for i in range(0, len(memory_ids), 50):
            chunk = memory_ids[i : i + 50]
            data = self._run_request(
                "POST", "/v1/memories/batch-delete", json={"ids": chunk}, timeout=timeout
            )
            for item in data.get("results", []):
                results.append(DeleteBatchItemResult.model_validate(item))
        return results

    #: Alias for :meth:`recall` — matches Mem0/Pinecone ``search`` convention.
    search = recall

    # ── Ingest ───────────────────────────────────────────────────────────

    def ingest(
        self,
        *,
        messages: _list[Message | dict[str, str]] | None = None,
        text: str | None = None,
        namespace: str | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
        auto_relate: bool | None = None,
        timeout: float | None = None,
    ) -> IngestResult:
        """Auto-extract and store facts from conversation or text.

        Args:
            timeout: Per-request timeout in seconds. Overrides the client default.
        """
        self._require_signed_auth("ingest")
        if not messages and not (text and text.strip()):
            raise ValueError("Either messages or text must be provided")
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

        data = self._run_request("POST", "/v1/ingest", json=body, timeout=timeout)
        return IngestResult.model_validate(data)

    # ── Extract ──────────────────────────────────────────────────────────

    def extract(
        self,
        messages: _list[Message | dict[str, str]],
        *,
        namespace: str | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
        timeout: float | None = None,
    ) -> ExtractResult:
        """Extract structured facts from conversation via LLM.

        Args:
            timeout: Per-request timeout in seconds. Overrides the client default.
        """
        self._require_signed_auth("extract")
        if not messages:
            raise ValueError("messages must be a non-empty list")
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

        data = self._run_request("POST", "/v1/memories/extract", json=body, timeout=timeout)
        return ExtractResult.model_validate(data)

    # ── Consolidate ──────────────────────────────────────────────────────

    def consolidate(
        self,
        *,
        namespace: str | None = None,
        min_similarity: float | None = None,
        mode: str | None = None,
        dry_run: bool | None = None,
        timeout: float | None = None,
    ) -> ConsolidateResult:
        """Merge similar memories by clustering.

        Args:
            timeout: Per-request timeout in seconds. Overrides the client default.
        """
        self._require_signed_auth("consolidate")
        body = _clean_body(
            {
                "namespace": namespace,
                "min_similarity": min_similarity,
                "mode": mode,
                "dry_run": dry_run,
            }
        )
        data = self._run_request("POST", "/v1/memories/consolidate", json=body, timeout=timeout)
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
        timeout: float | None = None,
    ) -> SuggestedResponse:
        """Get proactive memory suggestions.

        Args:
            timeout: Per-request timeout in seconds. Overrides the client default.
        """
        params = _clean_params(
            {
                "limit": limit,
                "namespace": namespace,
                "session_id": session_id,
                "agent_id": agent_id,
                "category": category,
            }
        )
        data = self._run_request("GET", "/v1/suggested", params=params, timeout=timeout)
        return SuggestedResponse.model_validate(data)

    # ── Relations ────────────────────────────────────────────────────────

    def create_relation(
        self,
        memory_id: str,
        target_id: str,
        relation_type: RelationType,
        *,
        metadata: dict[str, Any] | None = None,
        timeout: float | None = None,
    ) -> Relation:
        """Create a relationship between two memories.

        Args:
            timeout: Per-request timeout in seconds. Overrides the client default.
        """
        self._require_signed_auth("create_relation")
        _validate_non_empty(memory_id, "memory_id")
        _validate_non_empty(target_id, "target_id")
        body: dict[str, Any] = {
            "target_id": target_id,
            "relation_type": relation_type,
        }
        if metadata is not None:
            body["metadata"] = metadata
        data = self._run_request(
            "POST", f"/v1/memories/{quote(memory_id, safe='')}/relations", json=body, timeout=timeout
        )
        return Relation.model_validate(data)

    def list_relations(self, memory_id: str, *, timeout: float | None = None) -> _list[RelationWithMemory]:
        """List all relationships for a memory.

        Args:
            timeout: Per-request timeout in seconds. Overrides the client default.
        """
        _validate_non_empty(memory_id, "memory_id")
        data = self._run_request("GET", f"/v1/memories/{quote(memory_id, safe='')}/relations", timeout=timeout)
        resp = RelationsResponse.model_validate(data)
        return resp.relations

    def delete_relation(self, memory_id: str, relation_id: str, *, timeout: float | None = None) -> DeleteResult:
        """Delete a memory relationship.

        Args:
            timeout: Per-request timeout in seconds. Overrides the client default.
        """
        _validate_non_empty(memory_id, "memory_id")
        _validate_non_empty(relation_id, "relation_id")
        data = self._run_request(
            "DELETE", f"/v1/memories/{quote(memory_id, safe='')}/relations/{quote(relation_id, safe='')}", timeout=timeout
        )
        return DeleteResult.model_validate(data)

    # ── Status ───────────────────────────────────────────────────────────

    def status(self, *, timeout: float | None = None) -> FreeTierStatus:
        """Check free tier remaining calls.

        Args:
            timeout: Per-request timeout in seconds. Overrides the client default.
        """
        data = self._run_request("GET", "/v1/free-tier/status", timeout=timeout)
        return FreeTierStatus.model_validate(data)

    # ── Migrate ───────────────────────────────────────────────────────────

    def migrate(
        self,
        files: _list[dict[str, str]],
        *,
        namespace: str | None = None,
        agent_id: str | None = None,
        session_id: str | None = None,
        auto_tag: bool | None = None,
        timeout: float | None = None,
    ) -> MigrateResult:
        """Bulk import markdown memory files.

        Args:
            files: List of dicts with ``filename`` and ``content`` keys.
            namespace: Optional namespace for all imported memories.
            agent_id: Optional agent ID.
            session_id: Optional session ID.
            auto_tag: If True, auto-generate tags from content.

        Example::

            from pathlib import Path

            files = [
                {"filename": f.name, "content": f.read_text()}
                for f in Path("memories/").glob("*.md")
            ]
            result = client.migrate(files, namespace="imported")
        """
        self._require_signed_auth("migrate")
        if not files:
            raise ValueError("files list must not be empty")
        body: dict[str, Any] = {"files": files}
        if namespace is not None:
            body["namespace"] = namespace
        if agent_id is not None:
            body["agent_id"] = agent_id
        if session_id is not None:
            body["session_id"] = session_id
        if auto_tag is not None:
            body["auto_tag"] = auto_tag
        data = self._run_request("POST", "/v1/migrate", json=body, timeout=timeout)
        return MigrateResult.model_validate(data)

    def migrate_directory(
        self,
        directory: str | Path,
        *,
        pattern: str = "*.md",
        namespace: str | None = None,
        agent_id: str | None = None,
        session_id: str | None = None,
        auto_tag: bool | None = None,
        timeout: float | None = None,
    ) -> MigrateResult:
        """Convenience: migrate all matching files from a directory.

        Args:
            directory: Path to directory containing memory files.
            pattern: Glob pattern (default ``*.md``).
        """
        dir_path = Path(directory)
        if not dir_path.is_dir():
            raise ValueError(f"Directory not found: {directory}")
        files = [
            {"filename": f.name, "content": f.read_text(encoding="utf-8")}
            for f in sorted(dir_path.glob(pattern))
            if f.is_file()
        ]
        if not files:
            raise ValueError(f"No files matching '{pattern}' in {directory}")
        return self.migrate(
            files,
            namespace=namespace,
            agent_id=agent_id,
            session_id=session_id,
            auto_tag=auto_tag,
            timeout=timeout,
        )

    # ── Context ───────────────────────────────────────────────────────────

    def assemble_context(
        self,
        query: str,
        *,
        namespace: str | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
        max_memories: int | None = None,
        max_tokens: int | None = None,
        format: str | None = None,
        include_metadata: bool | None = None,
        summarize: bool | None = None,
        timeout: float | None = None,
    ) -> ContextResult:
        """Assemble a context block from memories for LLM prompts.

        Args:
            timeout: Per-request timeout in seconds. Overrides the client default.
        """
        self._require_signed_auth("assemble_context")
        _validate_non_empty(query, "query")
        body = _clean_body(
            {
                "query": query,
                "namespace": namespace,
                "session_id": session_id,
                "agent_id": agent_id,
                "max_memories": max_memories,
                "max_tokens": max_tokens,
                "format": format,
                "include_metadata": include_metadata,
                "summarize": summarize,
            }
        )
        data = self._run_request("POST", "/v1/context", json=body, timeout=timeout)
        return ContextResult.model_validate(data)

    # ── Namespaces ───────────────────────────────────────────────────────

    def list_namespaces(self, *, timeout: float | None = None) -> NamespacesResponse:
        """List all namespaces with memory counts.

        Args:
            timeout: Per-request timeout in seconds. Overrides the client default.
        """
        data = self._run_request("GET", "/v1/namespaces", timeout=timeout)
        return NamespacesResponse.model_validate(data)

    # ── Stats ────────────────────────────────────────────────────────────

    def stats(self, *, timeout: float | None = None) -> StatsResponse:
        """Get memory usage statistics.

        Args:
            timeout: Per-request timeout in seconds. Overrides the client default.
        """
        data = self._run_request("GET", "/v1/stats", timeout=timeout)
        return StatsResponse.model_validate(data)

    # ── Core Memories ────────────────────────────────────────────────────

    def core_memories(
        self,
        *,
        limit: int | None = None,
        namespace: str | None = None,
        agent_id: str | None = None,
        timeout: float | None = None,
    ) -> CoreMemoriesResponse:
        """Get high-importance, pinned, and frequently-accessed memories (FREE).

        Args:
            timeout: Per-request timeout in seconds. Overrides the client default.
        """
        params = _clean_params(
            {"limit": limit, "namespace": namespace, "agent_id": agent_id}
        )
        data = self._run_request("GET", "/v1/core-memories", params=params, timeout=timeout)
        return CoreMemoriesResponse.model_validate(data)

    # ── Text Search ──────────────────────────────────────────────────────

    def text_search(
        self,
        query: str,
        *,
        limit: int | None = None,
        namespace: str | None = None,
        tags: _list[str] | None = None,
        memory_type: MemoryType | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
        after: str | None = None,
        timeout: float | None = None,
    ) -> TextSearchResponse:
        """Keyword text search across memories (FREE).

        Args:
            timeout: Per-request timeout in seconds. Overrides the client default.
        """
        _validate_non_empty(query, "query")
        params = _clean_params(
            {
                "q": query,
                "limit": limit,
                "namespace": namespace,
                "tags": tags,
                "memory_type": memory_type,
                "session_id": session_id,
                "agent_id": agent_id,
                "after": after,
            }
        )
        data = self._run_request("GET", "/v1/memories/search", params=params, timeout=timeout)
        return TextSearchResponse.model_validate(data)

    # ── Export ────────────────────────────────────────────────────────────

    def export(
        self,
        *,
        format: str | None = None,
        namespace: str | None = None,
        memory_type: MemoryType | None = None,
        tags: _list[str] | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
        before: str | None = None,
        after: str | None = None,
        include_deleted: bool | None = None,
        timeout: float | None = None,
    ) -> ExportResponse:
        """Export memories in JSON, CSV, or Markdown format.

        Args:
            timeout: Per-request timeout in seconds. Overrides the client default.
        """
        params = _clean_params(
            {
                "format": format,
                "namespace": namespace,
                "memory_type": memory_type,
                "tags": tags,
                "session_id": session_id,
                "agent_id": agent_id,
                "before": before,
                "after": after,
                "include_deleted": include_deleted,
            }
        )
        data = self._run_request("GET", "/v1/export", params=params, timeout=timeout)
        return ExportResponse.model_validate(data)

    def iter_export(
        self,
        *,
        batch_size: int = 50,
        namespace: str | None = None,
        memory_type: MemoryType | None = None,
        tags: _list[str] | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
        before: str | None = None,
        after: str | None = None,
        include_deleted: bool | None = None,
    ) -> Iterator[Memory]:
        """Iterate over exportable memories with automatic pagination.

        Unlike :meth:`export` which loads all memories into a single response,
        this method yields individual :class:`Memory` objects in batches,
        making it memory-efficient for large memory sets.

        Args:
            batch_size: Number of memories to fetch per request (default 50).
            namespace: Filter by namespace.
            memory_type: Filter by memory type.
            tags: Filter by tags.
            session_id: Filter by session ID.
            agent_id: Filter by agent ID.
            before: Only memories created before this ISO timestamp.
            after: Only memories created after this ISO timestamp.
            include_deleted: Whether to include soft-deleted memories.

        Yields:
            Individual :class:`Memory` objects.
        """
        offset = 0
        while True:
            page = self.list(
                limit=batch_size,
                offset=offset,
                namespace=namespace,
                tags=tags,
                session_id=session_id,
                agent_id=agent_id,
                memory_type=memory_type,
                before=before,
                after=after,
                include_deleted=include_deleted,
            )
            yield from page.memories
            offset += len(page.memories)
            if offset >= page.total or not page.memories:
                break

    # ── History ──────────────────────────────────────────────────────────

    def get_history(self, memory_id: str, *, timeout: float | None = None) -> _list[HistoryEntry]:
        """Get the change history for a memory.

        Args:
            timeout: Per-request timeout in seconds. Overrides the client default.
        """
        _validate_non_empty(memory_id, "memory_id")
        data = self._run_request("GET", f"/v1/memories/{quote(memory_id, safe='')}/history", timeout=timeout)
        resp = HistoryResponse.model_validate(data)
        return resp.history

    # ── Pagination iterator ──────────────────────────────────────────────

    def list_all(
        self,
        *,
        batch_size: int = 50,
        namespace: str | None = None,
        tags: _list[str] | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
    ) -> Iterator[Memory]:
        """Iterate over all memories with automatic pagination.

        .. deprecated::
            Use :meth:`iter_memories` instead. Will be removed in a future major version.
        """
        import warnings
        warnings.warn("list_all is deprecated, use iter_memories instead", DeprecationWarning, stacklevel=2)
        yield from self.iter_memories(
            batch_size=batch_size,
            namespace=namespace,
            tags=tags,
            session_id=session_id,
            agent_id=agent_id,
        )

    # ── Graph helpers ────────────────────────────────────────────────────

    def get_memory_graph(
        self,
        memory_id: str,
        *,
        depth: int = 1,
    ) -> dict[str, _list[RelationWithMemory]]:
        """Traverse the memory graph from a starting node.

        Returns a dict mapping memory IDs to their relations, up to ``depth`` hops.

        Example::

            graph = client.get_memory_graph("mem-123", depth=2)
            for mid, rels in graph.items():
                print(f"{mid}: {len(rels)} relations")
        """
        visited: dict[str, _list[RelationWithMemory]] = {}
        frontier = [memory_id]

        for _ in range(depth):
            next_frontier: _list[str] = []
            for mid in frontier:
                if mid in visited:
                    continue
                rels = self.list_relations(mid)
                visited[mid] = rels
                for rel in rels:
                    neighbor_id = rel.memory.id
                    if neighbor_id not in visited:
                        next_frontier.append(neighbor_id)
            frontier = next_frontier
            if not frontier:
                break

        return visited

    def find_related(
        self,
        memory_id: str,
        *,
        relation_type: RelationType | None = None,
        direction: str | None = None,
    ) -> _list[RelationWithMemory]:
        """Find relations for a memory, optionally filtered by type and direction.

        Example::

            contradictions = client.find_related("mem-123", relation_type="contradicts")
        """
        rels = self.list_relations(memory_id)
        if relation_type is not None:
            rels = [r for r in rels if r.relation_type == relation_type]
        if direction is not None:
            rels = [r for r in rels if r.direction == direction]
        return rels


class AsyncMemoClaw:
    """Asynchronous MemoClaw client.

    Args:
        private_key: Ethereum private key for wallet auth.
            Falls back to ``MEMOCLAW_PRIVATE_KEY`` env var.
        wallet_address: Ethereum wallet address for read-only access to free
            endpoints.  See :class:`MemoClaw` for details on wallet-only mode.
        base_url: API base URL. Defaults to ``https://api.memoclaw.com``.
        timeout: Request timeout in seconds. Defaults to 30.
        max_retries: Maximum retry attempts for transient errors. Defaults to 2.
        pool_max_connections: Maximum number of connections in the pool. Defaults to 10.
        pool_max_keepalive: Maximum number of keep-alive connections. Defaults to 5.
    """

    def __init__(
        self,
        private_key: str | None = None,
        *,
        wallet_address: str | None = None,
        base_url: str | None = None,
        timeout: float = DEFAULT_TIMEOUT,
        max_retries: int | None = None,
        pool_max_connections: int = DEFAULT_POOL_MAX_CONNECTIONS,
        pool_max_keepalive: int = DEFAULT_POOL_MAX_KEEPALIVE_CONNECTIONS,
        config_path: str | Path | None = None,
    ) -> None:
        config = load_config(config_path)
        resolved_url = resolve_base_url(base_url, config)
        resolved_wallet = resolve_wallet_address(wallet_address, config)
        resolved_key = resolve_private_key(private_key, config, wallet_address=resolved_wallet)

        if resolved_key is None and resolved_wallet is None:
            raise ValueError(
                "No authentication provided. Pass private_key= or wallet_address=, "
                "set MEMOCLAW_PRIVATE_KEY / MEMOCLAW_WALLET, "
                "or run `memoclaw init` to create ~/.memoclaw/config.json."
            )

        kwargs: dict[str, Any] = {
            "base_url": resolved_url,
            "timeout": timeout,
            "pool_max_connections": pool_max_connections,
            "pool_max_keepalive": pool_max_keepalive,
        }
        if resolved_key is not None:
            kwargs["private_key"] = resolved_key
        else:
            kwargs["wallet_address"] = resolved_wallet
        if max_retries is not None:
            kwargs["max_retries"] = max_retries
        self._http = _AsyncHTTPClient(**kwargs)
        self._before_request_hooks: _list[BeforeRequestHook] = []
        self._after_response_hooks: _list[AfterResponseHook] = []
        self._on_error_hooks: _list[OnErrorHook] = []

    # ── Auth helpers ────────────────────────────────────────────────────

    def _require_signed_auth(self, method_name: str) -> None:
        """Raise if the client is in wallet-only mode (no private key).

        Paid endpoints require cryptographic signature auth. This gives a
        clear client-side error instead of a confusing server 401/403.
        """
        if self._http._account is None:
            raise ValueError(
                f"{method_name}() requires a private key for signed authentication. "
                "Pass private_key= option, set MEMOCLAW_PRIVATE_KEY, "
                "or run `memoclaw init`."
            )

    # ── Hooks API ────────────────────────────────────────────────────────

    def on_before_request(self, hook: BeforeRequestHook) -> AsyncMemoClaw:
        """Register a hook called before each request. Returns self for chaining."""
        self._before_request_hooks.append(hook)
        return self

    def on_after_response(self, hook: AfterResponseHook) -> AsyncMemoClaw:
        """Register a hook called after each successful response. Returns self for chaining."""
        self._after_response_hooks.append(hook)
        return self

    def on_error(self, hook: OnErrorHook) -> AsyncMemoClaw:
        """Register a hook called on errors. Returns self for chaining."""
        self._on_error_hooks.append(hook)
        return self

    async def _run_request(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
        timeout: float | None = None,
    ) -> Any:
        """Internal request wrapper that invokes hooks.

        Args:
            timeout: Per-request timeout in seconds. Overrides the client default.
        """
        body = json
        for before_hook in self._before_request_hooks:
            result = before_hook(method, path, body)
            if result is not None:
                body = result
        try:
            data = await self._http.request(method, path, json=body, params=params, timeout=timeout)
        except Exception as exc:
            for error_hook in self._on_error_hooks:
                error_hook(method, path, exc)
            raise
        for after_hook in self._after_response_hooks:
            transformed = after_hook(method, path, data)
            if transformed is not None:
                data = transformed
        return data

    # ── Representation ───────────────────────────────────────────────────

    def __repr__(self) -> str:
        wallet = self._http._wallet_address
        truncated = f"{wallet[:6]}...{wallet[-4:]}" if len(wallet) > 10 else wallet
        mode = "signed" if self._http._account is not None else "wallet-only"
        return f"AsyncMemoClaw(base_url={self._http._base_url!r}, wallet={truncated!r}, mode={mode!r})"

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
        tags: _list[str] | None = None,
        namespace: str | None = None,
        memory_type: MemoryType | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
        expires_at: str | None = None,
        pinned: bool | None = None,
        immutable: bool | None = None,
        metadata: dict[str, Any] | None = None,
        timeout: float | None = None,
    ) -> StoreResult:
        """Store a memory.

        Args:
            timeout: Per-request timeout in seconds. Overrides the client default.
        """
        self._require_signed_auth("store")
        _validate_non_empty(content, "content")
        body = _build_store_body(
            content,
            importance=importance,
            tags=tags,
            namespace=namespace,
            memory_type=memory_type,
            session_id=session_id,
            agent_id=agent_id,
            expires_at=expires_at,
            pinned=pinned,
            immutable=immutable,
            metadata=metadata,
        )
        data = await self._run_request("POST", "/v1/store", json=body, timeout=timeout)
        return StoreResult.model_validate(data)

    async def store_batch(
        self,
        memories: Sequence[StoreInput | dict[str, Any]],
        *,
        timeout: float | None = None,
    ) -> StoreBatchResult:
        """Store up to 100 memories at once.

        Args:
            timeout: Per-request timeout in seconds. Overrides the client default.
        """
        self._require_signed_auth("store_batch")
        if not memories:
            raise ValueError("memories list must not be empty")
        if len(memories) > MAX_BATCH_SIZE:
            raise ValueError(
                f"Batch size {len(memories)} exceeds maximum of {MAX_BATCH_SIZE}"
            )
        items = [
            _normalize_store_input(m) if isinstance(m, StoreInput) else m
            for m in memories
        ]
        data = await self._run_request(
            "POST", "/v1/store/batch", json={"memories": items}, timeout=timeout
        )
        return StoreBatchResult.model_validate(data)

    def store_builder(self) -> AsyncStoreBuilder:
        """Create an AsyncStoreBuilder for fluent memory creation.

        Example:
            >>> result = await (client.store_builder()
            ...     .content("User prefers dark mode")
            ...     .importance(0.9)
            ...     .tags(["preferences"])
            ...     .execute())
        """
        return AsyncStoreBuilder(self)

    # ── Recall ───────────────────────────────────────────────────────────

    async def recall(
        self,
        query: str,
        *,
        limit: int | None = None,
        min_similarity: float | None = None,
        namespace: str | None = None,
        tags: _list[str] | None = None,
        include_relations: bool | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
        after: str | None = None,
        memory_type: MemoryType | None = None,
        timeout: float | None = None,
    ) -> RecallResponse:
        """Semantic recall of memories matching a query."""
        self._require_signed_auth("recall")
        _validate_non_empty(query, "query")
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
        if tags is not None or after is not None or memory_type is not None:
            filters: dict[str, Any] = {}
            if tags is not None:
                filters["tags"] = tags
            if after is not None:
                filters["after"] = after
            if memory_type is not None:
                filters["memory_type"] = memory_type
            body["filters"] = filters

        data = await self._run_request("POST", "/v1/recall", json=body, timeout=timeout)
        return RecallResponse.model_validate(data)

    # ── List ─────────────────────────────────────────────────────────────

    async def list(
        self,
        *,
        limit: int | None = None,
        offset: int | None = None,
        namespace: str | None = None,
        tags: _list[str] | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
        memory_type: MemoryType | None = None,
        before: str | None = None,
        after: str | None = None,
        include_deleted: bool | None = None,
        timeout: float | None = None,
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
                "memory_type": memory_type,
                "before": before,
                "after": after,
                "include_deleted": include_deleted,
            }
        )
        data = await self._run_request("GET", "/v1/memories", params=params, timeout=timeout)
        return ListResponse.model_validate(data)

    async def iter_memories(
        self,
        *,
        batch_size: int = 50,
        namespace: str | None = None,
        tags: _list[str] | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
        memory_type: MemoryType | None = None,
        before: str | None = None,
        after: str | None = None,
        include_deleted: bool | None = None,
    ) -> AsyncIterator[Memory]:
        """Iterate over all memories with automatic pagination.

        Yields individual :class:`Memory` objects, fetching pages transparently.
        Supports all the same filters as :meth:`list`.
        """
        offset = 0
        while True:
            page = await self.list(
                limit=batch_size,
                offset=offset,
                namespace=namespace,
                tags=tags,
                session_id=session_id,
                agent_id=agent_id,
                memory_type=memory_type,
                before=before,
                after=after,
                include_deleted=include_deleted,
            )
            for mem in page.memories:
                yield mem
            offset += len(page.memories)
            if offset >= page.total or not page.memories:
                break

    # ── Get ──────────────────────────────────────────────────────────────

    async def get(self, memory_id: str, *, timeout: float | None = None) -> Memory:
        """Retrieve a single memory by ID."""
        _validate_non_empty(memory_id, "memory_id")
        data = await self._run_request("GET", f"/v1/memories/{quote(memory_id, safe='')}", timeout=timeout)
        return Memory.model_validate(data)

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
        pinned: bool | None = None,
        immutable: bool | None = None,
        expires_at: str | None | EllipsisType = ...,
        timeout: float | None = None,
    ) -> Memory:
        """Update a memory by ID. Only provided fields are updated.

        Args:
            timeout: Per-request timeout in seconds. Overrides the client default.
        """
        self._require_signed_auth("update")
        _validate_non_empty(memory_id, "memory_id")
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
        if pinned is not None:
            body["pinned"] = pinned
        if immutable is not None:
            body["immutable"] = immutable
        if expires_at is not ...:
            body["expires_at"] = expires_at

        data = await self._run_request(
            "PATCH", f"/v1/memories/{quote(memory_id, safe='')}", json=body, timeout=timeout
        )
        return Memory.model_validate(data)

    # ── Batch Update ─────────────────────────────────────────────────────

    async def update_batch(
        self,
        updates: _list[UpdateInput | dict[str, Any]],
        *,
        timeout: float | None = None,
    ) -> UpdateBatchResult:
        """Update multiple memories in a single request.

        Each update must include an ``id`` and at least one field to change.

        Args:
            updates: List of :class:`UpdateInput` or dicts with ``id`` plus fields to update.

        Example::

            result = await client.update_batch([
                {"id": "mem-1", "importance": 0.9},
                {"id": "mem-2", "content": "Updated content", "pinned": True},
            ])
        """
        self._require_signed_auth("update_batch")
        if not updates:
            raise ValueError("updates list must not be empty")
        if len(updates) > MAX_BATCH_SIZE:
            raise ValueError(
                f"Batch size {len(updates)} exceeds maximum of {MAX_BATCH_SIZE}"
            )
        items = [
            u.model_dump(exclude_none=True) if isinstance(u, UpdateInput) else u
            for u in updates
        ]
        for item in items:
            if "id" not in item or not item["id"]:
                raise ValueError("Each update must include a non-empty 'id'")
        data = await self._run_request(
            "POST", "/v1/memories/batch-update", json={"updates": items}, timeout=timeout
        )
        return UpdateBatchResult.model_validate(data)

    # ── Delete ───────────────────────────────────────────────────────────

    async def delete(self, memory_id: str, *, timeout: float | None = None) -> DeleteResult:
        """Delete a memory by ID."""
        _validate_non_empty(memory_id, "memory_id")
        data = await self._run_request("DELETE", f"/v1/memories/{quote(memory_id, safe='')}", timeout=timeout)
        return DeleteResult.model_validate(data)

    async def delete_batch(self, memory_ids: _list[str], *, timeout: float | None = None) -> _list[DeleteBatchItemResult]:
        """Delete multiple memories by ID using the batch endpoint.

        Processes in chunks of 50 for API compatibility.
        Returns a list of :class:`DeleteBatchItemResult` objects.
        """
        if not memory_ids:
            return []
        results: _list[DeleteBatchItemResult] = []
        for i in range(0, len(memory_ids), 50):
            chunk = memory_ids[i : i + 50]
            data = await self._run_request(
                "POST", "/v1/memories/batch-delete", json={"ids": chunk}, timeout=timeout
            )
            for item in data.get("results", []):
                results.append(DeleteBatchItemResult.model_validate(item))
        return results

    #: Alias for :meth:`recall` — matches Mem0/Pinecone ``search`` convention.
    search = recall

    # ── Ingest ───────────────────────────────────────────────────────────

    async def ingest(
        self,
        *,
        messages: _list[Message | dict[str, str]] | None = None,
        text: str | None = None,
        namespace: str | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
        auto_relate: bool | None = None,
        timeout: float | None = None,
    ) -> IngestResult:
        """Auto-extract and store facts from conversation or text.

        Args:
            timeout: Per-request timeout in seconds. Overrides the client default.
        """
        self._require_signed_auth("ingest")
        if not messages and not (text and text.strip()):
            raise ValueError("Either messages or text must be provided")
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

        data = await self._run_request("POST", "/v1/ingest", json=body, timeout=timeout)
        return IngestResult.model_validate(data)

    # ── Extract ──────────────────────────────────────────────────────────

    async def extract(
        self,
        messages: _list[Message | dict[str, str]],
        *,
        namespace: str | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
        timeout: float | None = None,
    ) -> ExtractResult:
        """Extract structured facts from conversation via LLM.

        Args:
            timeout: Per-request timeout in seconds. Overrides the client default.
        """
        self._require_signed_auth("extract")
        if not messages:
            raise ValueError("messages must be a non-empty list")
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

        data = await self._run_request("POST", "/v1/memories/extract", json=body, timeout=timeout)
        return ExtractResult.model_validate(data)

    # ── Consolidate ──────────────────────────────────────────────────────

    async def consolidate(
        self,
        *,
        namespace: str | None = None,
        min_similarity: float | None = None,
        mode: str | None = None,
        dry_run: bool | None = None,
        timeout: float | None = None,
    ) -> ConsolidateResult:
        """Merge similar memories by clustering.

        Args:
            timeout: Per-request timeout in seconds. Overrides the client default.
        """
        self._require_signed_auth("consolidate")
        body = _clean_body(
            {
                "namespace": namespace,
                "min_similarity": min_similarity,
                "mode": mode,
                "dry_run": dry_run,
            }
        )
        data = await self._run_request(
            "POST", "/v1/memories/consolidate", json=body, timeout=timeout
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
        timeout: float | None = None,
    ) -> SuggestedResponse:
        """Get proactive memory suggestions.

        Args:
            timeout: Per-request timeout in seconds. Overrides the client default.
        """
        params = _clean_params(
            {
                "limit": limit,
                "namespace": namespace,
                "session_id": session_id,
                "agent_id": agent_id,
                "category": category,
            }
        )
        data = await self._run_request("GET", "/v1/suggested", params=params, timeout=timeout)
        return SuggestedResponse.model_validate(data)

    # ── Relations ────────────────────────────────────────────────────────

    async def create_relation(
        self,
        memory_id: str,
        target_id: str,
        relation_type: RelationType,
        *,
        metadata: dict[str, Any] | None = None,
        timeout: float | None = None,
    ) -> Relation:
        """Create a relationship between two memories.

        Args:
            timeout: Per-request timeout in seconds. Overrides the client default.
        """
        self._require_signed_auth("create_relation")
        _validate_non_empty(memory_id, "memory_id")
        _validate_non_empty(target_id, "target_id")
        body: dict[str, Any] = {
            "target_id": target_id,
            "relation_type": relation_type,
        }
        if metadata is not None:
            body["metadata"] = metadata
        data = await self._run_request(
            "POST", f"/v1/memories/{quote(memory_id, safe='')}/relations", json=body, timeout=timeout
        )
        return Relation.model_validate(data)

    async def list_relations(self, memory_id: str, *, timeout: float | None = None) -> _list[RelationWithMemory]:
        """List all relationships for a memory."""
        _validate_non_empty(memory_id, "memory_id")
        data = await self._run_request(
            "GET", f"/v1/memories/{quote(memory_id, safe='')}/relations", timeout=timeout
        )
        resp = RelationsResponse.model_validate(data)
        return resp.relations

    async def delete_relation(
        self, memory_id: str, relation_id: str, *, timeout: float | None = None
    ) -> DeleteResult:
        """Delete a memory relationship."""
        _validate_non_empty(memory_id, "memory_id")
        _validate_non_empty(relation_id, "relation_id")
        data = await self._run_request(
            "DELETE", f"/v1/memories/{quote(memory_id, safe='')}/relations/{quote(relation_id, safe='')}", timeout=timeout
        )
        return DeleteResult.model_validate(data)

    # ── Status ───────────────────────────────────────────────────────────

    async def status(self, *, timeout: float | None = None) -> FreeTierStatus:
        """Check free tier remaining calls.

        Args:
            timeout: Per-request timeout in seconds. Overrides the client default.
        """
        data = await self._run_request("GET", "/v1/free-tier/status", timeout=timeout)
        return FreeTierStatus.model_validate(data)

    # ── Migrate ───────────────────────────────────────────────────────────

    async def migrate(
        self,
        files: _list[dict[str, str]],
        *,
        namespace: str | None = None,
        agent_id: str | None = None,
        session_id: str | None = None,
        auto_tag: bool | None = None,
        timeout: float | None = None,
    ) -> MigrateResult:
        """Bulk import markdown memory files. See sync version for details."""
        self._require_signed_auth("migrate")
        if not files:
            raise ValueError("files list must not be empty")
        body: dict[str, Any] = {"files": files}
        if namespace is not None:
            body["namespace"] = namespace
        if agent_id is not None:
            body["agent_id"] = agent_id
        if session_id is not None:
            body["session_id"] = session_id
        if auto_tag is not None:
            body["auto_tag"] = auto_tag
        data = await self._run_request("POST", "/v1/migrate", json=body, timeout=timeout)
        return MigrateResult.model_validate(data)

    async def migrate_directory(
        self,
        directory: str | Path,
        *,
        pattern: str = "*.md",
        namespace: str | None = None,
        agent_id: str | None = None,
        session_id: str | None = None,
        auto_tag: bool | None = None,
        timeout: float | None = None,
    ) -> MigrateResult:
        """Convenience: migrate all matching files from a directory. See sync version for details."""
        import asyncio

        dir_path = Path(directory)

        def _read_files() -> _list[dict[str, str]]:
            if not dir_path.is_dir():
                raise ValueError(f"Directory not found: {directory}")
            return [
                {"filename": f.name, "content": f.read_text(encoding="utf-8")}
                for f in sorted(dir_path.glob(pattern))
                if f.is_file()
            ]

        files = await asyncio.to_thread(_read_files)
        if not files:
            raise ValueError(f"No files matching '{pattern}' in {directory}")
        return await self.migrate(
            files,
            namespace=namespace,
            agent_id=agent_id,
            session_id=session_id,
            auto_tag=auto_tag,
            timeout=timeout,
        )

    # ── Context ───────────────────────────────────────────────────────────

    async def assemble_context(
        self,
        query: str,
        *,
        namespace: str | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
        max_memories: int | None = None,
        max_tokens: int | None = None,
        format: str | None = None,
        include_metadata: bool | None = None,
        summarize: bool | None = None,
        timeout: float | None = None,
    ) -> ContextResult:
        """Assemble a context block from memories for LLM prompts.

        Args:
            timeout: Per-request timeout in seconds. Overrides the client default.
        """
        self._require_signed_auth("assemble_context")
        _validate_non_empty(query, "query")
        body = _clean_body(
            {
                "query": query,
                "namespace": namespace,
                "session_id": session_id,
                "agent_id": agent_id,
                "max_memories": max_memories,
                "max_tokens": max_tokens,
                "format": format,
                "include_metadata": include_metadata,
                "summarize": summarize,
            }
        )
        data = await self._run_request("POST", "/v1/context", json=body, timeout=timeout)
        return ContextResult.model_validate(data)

    # ── Namespaces ───────────────────────────────────────────────────────

    async def list_namespaces(self, *, timeout: float | None = None) -> NamespacesResponse:
        """List all namespaces with memory counts.

        Args:
            timeout: Per-request timeout in seconds. Overrides the client default.
        """
        data = await self._run_request("GET", "/v1/namespaces", timeout=timeout)
        return NamespacesResponse.model_validate(data)

    # ── Stats ────────────────────────────────────────────────────────────

    async def stats(self, *, timeout: float | None = None) -> StatsResponse:
        """Get memory usage statistics.

        Args:
            timeout: Per-request timeout in seconds. Overrides the client default.
        """
        data = await self._run_request("GET", "/v1/stats", timeout=timeout)
        return StatsResponse.model_validate(data)

    # ── Core Memories ────────────────────────────────────────────────────

    async def core_memories(
        self,
        *,
        limit: int | None = None,
        namespace: str | None = None,
        agent_id: str | None = None,
        timeout: float | None = None,
    ) -> CoreMemoriesResponse:
        """Get high-importance, pinned, and frequently-accessed memories (FREE).

        Args:
            timeout: Per-request timeout in seconds. Overrides the client default.
        """
        params = _clean_params(
            {"limit": limit, "namespace": namespace, "agent_id": agent_id}
        )
        data = await self._run_request("GET", "/v1/core-memories", params=params, timeout=timeout)
        return CoreMemoriesResponse.model_validate(data)

    # ── Text Search ──────────────────────────────────────────────────────

    async def text_search(
        self,
        query: str,
        *,
        limit: int | None = None,
        namespace: str | None = None,
        tags: _list[str] | None = None,
        memory_type: MemoryType | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
        after: str | None = None,
        timeout: float | None = None,
    ) -> TextSearchResponse:
        """Keyword text search across memories (FREE).

        Args:
            timeout: Per-request timeout in seconds. Overrides the client default.
        """
        _validate_non_empty(query, "query")
        params = _clean_params(
            {
                "q": query,
                "limit": limit,
                "namespace": namespace,
                "tags": tags,
                "memory_type": memory_type,
                "session_id": session_id,
                "agent_id": agent_id,
                "after": after,
            }
        )
        data = await self._run_request("GET", "/v1/memories/search", params=params, timeout=timeout)
        return TextSearchResponse.model_validate(data)

    # ── Export ────────────────────────────────────────────────────────────

    async def export(
        self,
        *,
        format: str | None = None,
        namespace: str | None = None,
        memory_type: MemoryType | None = None,
        tags: _list[str] | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
        before: str | None = None,
        after: str | None = None,
        include_deleted: bool | None = None,
        timeout: float | None = None,
    ) -> ExportResponse:
        """Export memories in JSON, CSV, or Markdown format.

        Args:
            timeout: Per-request timeout in seconds. Overrides the client default.
        """
        params = _clean_params(
            {
                "format": format,
                "namespace": namespace,
                "memory_type": memory_type,
                "tags": tags,
                "session_id": session_id,
                "agent_id": agent_id,
                "before": before,
                "after": after,
                "include_deleted": include_deleted,
            }
        )
        data = await self._run_request("GET", "/v1/export", params=params, timeout=timeout)
        return ExportResponse.model_validate(data)

    async def iter_export(
        self,
        *,
        batch_size: int = 50,
        namespace: str | None = None,
        memory_type: MemoryType | None = None,
        tags: _list[str] | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
        before: str | None = None,
        after: str | None = None,
        include_deleted: bool | None = None,
    ) -> AsyncIterator[Memory]:
        """Iterate over exportable memories with automatic pagination.

        Async counterpart of :meth:`MemoClaw.iter_export`. Yields individual
        :class:`Memory` objects in batches for memory-efficient large exports.

        Args:
            batch_size: Number of memories to fetch per request (default 50).
            namespace: Filter by namespace.
            memory_type: Filter by memory type.
            tags: Filter by tags.
            session_id: Filter by session ID.
            agent_id: Filter by agent ID.
            before: Only memories created before this ISO timestamp.
            after: Only memories created after this ISO timestamp.
            include_deleted: Whether to include soft-deleted memories.

        Yields:
            Individual :class:`Memory` objects.
        """
        offset = 0
        while True:
            page = await self.list(
                limit=batch_size,
                offset=offset,
                namespace=namespace,
                tags=tags,
                session_id=session_id,
                agent_id=agent_id,
                memory_type=memory_type,
                before=before,
                after=after,
                include_deleted=include_deleted,
            )
            for memory in page.memories:
                yield memory
            offset += len(page.memories)
            if offset >= page.total or not page.memories:
                break

    # ── History ──────────────────────────────────────────────────────────

    async def get_history(self, memory_id: str, *, timeout: float | None = None) -> _list[HistoryEntry]:
        """Get the change history for a memory."""
        _validate_non_empty(memory_id, "memory_id")
        data = await self._run_request("GET", f"/v1/memories/{quote(memory_id, safe='')}/history", timeout=timeout)
        resp = HistoryResponse.model_validate(data)
        return resp.history

    # ── Async pagination iterator ────────────────────────────────────────

    async def list_all(
        self,
        *,
        batch_size: int = 50,
        namespace: str | None = None,
        tags: _list[str] | None = None,
        session_id: str | None = None,
        agent_id: str | None = None,
    ) -> AsyncIterator[Memory]:
        """Async iterate over all memories with automatic pagination.

        .. deprecated::
            Use :meth:`iter_memories` instead. Will be removed in a future major version.
        """
        import warnings
        warnings.warn("list_all is deprecated, use iter_memories instead", DeprecationWarning, stacklevel=2)
        async for memory in self.iter_memories(
            batch_size=batch_size,
            namespace=namespace,
            tags=tags,
            session_id=session_id,
            agent_id=agent_id,
        ):
            yield memory

    # ── Graph helpers ────────────────────────────────────────────────────

    async def get_memory_graph(
        self,
        memory_id: str,
        *,
        depth: int = 1,
    ) -> dict[str, _list[RelationWithMemory]]:
        """Traverse the memory graph from a starting node. See sync version for details."""
        visited: dict[str, _list[RelationWithMemory]] = {}
        frontier = [memory_id]

        for _ in range(depth):
            next_frontier: _list[str] = []
            for mid in frontier:
                if mid in visited:
                    continue
                rels = await self.list_relations(mid)
                visited[mid] = rels
                for rel in rels:
                    neighbor_id = rel.memory.id
                    if neighbor_id not in visited:
                        next_frontier.append(neighbor_id)
            frontier = next_frontier
            if not frontier:
                break

        return visited

    async def find_related(
        self,
        memory_id: str,
        *,
        relation_type: RelationType | None = None,
        direction: str | None = None,
    ) -> _list[RelationWithMemory]:
        """Find relations for a memory, optionally filtered. See sync version for details."""
        rels = await self.list_relations(memory_id)
        if relation_type is not None:
            rels = [r for r in rels if r.relation_type == relation_type]
        if direction is not None:
            rels = [r for r in rels if r.direction == direction]
        return rels
