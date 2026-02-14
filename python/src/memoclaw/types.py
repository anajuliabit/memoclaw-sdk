"""Pydantic models for MemoClaw API requests and responses."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

MemoryType = Literal[
    "correction", "preference", "decision", "project", "observation", "general"
]

RelationType = Literal[
    "related_to", "derived_from", "contradicts", "supersedes", "supports"
]

SuggestedCategory = Literal["stale", "fresh", "hot", "decaying"]


# ── Shared ────────────────────────────────────────────────────────────────────


class Message(BaseModel):
    role: str
    content: str


class RelatedMemorySummary(BaseModel):
    id: str
    content: str
    importance: float
    memory_type: str
    namespace: str


class RelationWithMemory(BaseModel):
    id: str
    relation_type: RelationType
    direction: Literal["outgoing", "incoming"]
    memory: RelatedMemorySummary
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: str


class Relation(BaseModel):
    id: str
    source_id: str
    target_id: str
    relation_type: RelationType
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: str


# ── Memory ────────────────────────────────────────────────────────────────────


class Memory(BaseModel):
    id: str
    user_id: str
    namespace: str
    content: str
    embedding_model: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    importance: float
    memory_type: MemoryType
    session_id: str | None = None
    agent_id: str | None = None
    created_at: str
    updated_at: str
    accessed_at: str
    access_count: int
    deleted_at: str | None = None
    expires_at: str | None = None


# ── Recall ────────────────────────────────────────────────────────────────────


class RecallSignals(BaseModel):
    vector: float
    keyword: float
    recency: float
    base_importance: float
    effective_importance: float
    context_importance: float
    relation_count: int
    type_decay: float


class RecallMemory(BaseModel):
    id: str
    content: str
    similarity: float
    metadata: dict[str, Any] = Field(default_factory=dict)
    importance: float
    memory_type: MemoryType
    namespace: str
    session_id: str | None = None
    agent_id: str | None = None
    pinned: bool = False
    created_at: str
    access_count: int
    relations: list[RelationWithMemory] | None = None
    signals: RecallSignals | None = Field(default=None, alias="_signals")


# ── Store ─────────────────────────────────────────────────────────────────────


class StoreResult(BaseModel):
    id: str
    stored: bool
    deduplicated: bool
    tokens_used: int


class StoreBatchResult(BaseModel):
    ids: list[str]
    stored: bool
    count: int
    deduplicated_count: int
    tokens_used: int


# ── Recall response ──────────────────────────────────────────────────────────


class RecallResponse(BaseModel):
    memories: list[RecallMemory]
    query_tokens: int


# ── List response ────────────────────────────────────────────────────────────


class ListResponse(BaseModel):
    memories: list[Memory]
    total: int
    limit: int
    offset: int


# ── Delete ───────────────────────────────────────────────────────────────────


class DeleteResult(BaseModel):
    deleted: bool
    id: str | None = None


# ── Ingest ───────────────────────────────────────────────────────────────────


class IngestResult(BaseModel):
    memory_ids: list[str]
    facts_extracted: int
    facts_stored: int
    facts_deduplicated: int
    relations_created: int
    tokens_used: int


# ── Extract ──────────────────────────────────────────────────────────────────


class ExtractResult(BaseModel):
    memory_ids: list[str]
    facts_extracted: int
    facts_stored: int
    facts_deduplicated: int
    tokens_used: int


# ── Consolidate ──────────────────────────────────────────────────────────────


class ClusterInfo(BaseModel):
    memory_ids: list[str]
    similarity: float
    merged_into: str | None = None


class ConsolidateResult(BaseModel):
    clusters_found: int
    memories_merged: int
    memories_created: int
    clusters: list[ClusterInfo]


# ── Suggested ────────────────────────────────────────────────────────────────


class SuggestedMemory(BaseModel):
    id: str
    content: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    importance: float
    memory_type: str
    namespace: str
    session_id: str | None = None
    agent_id: str | None = None
    created_at: str
    accessed_at: str
    access_count: int
    relation_count: int
    category: SuggestedCategory
    review_score: float


class SuggestedResponse(BaseModel):
    suggested: list[SuggestedMemory]
    categories: dict[str, int]
    total: int


# ── Relations response ───────────────────────────────────────────────────────


class RelationsResponse(BaseModel):
    relations: list[RelationWithMemory]


# ── Free-tier status ─────────────────────────────────────────────────────────


class MigrateResult(BaseModel):
    """Result of a bulk markdown migration."""

    memory_ids: list[str]
    files_processed: int
    memories_created: int
    memories_deduplicated: int
    tokens_used: int


class FreeTierStatus(BaseModel):
    wallet: str
    free_tier_remaining: int
    free_tier_total: int
    free_tier_used: int


# ── Batch store input ────────────────────────────────────────────────────────


class StoreInput(BaseModel):
    """Input for a single memory in a batch store request."""

    content: str
    metadata: dict[str, Any] | None = None
    importance: float | None = None
    tags: list[str] | None = None
    namespace: str | None = None
    memory_type: MemoryType | None = None
    session_id: str | None = None
    agent_id: str | None = None
    expires_at: str | None = None
    pinned: bool | None = None
