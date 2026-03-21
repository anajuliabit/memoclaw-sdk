"""Pydantic AI integration helpers for MemoClaw.

This module exposes ready-to-use tools for [Pydantic AI](https://ai.pydantic.dev)
agents:

- :func:`memoclaw_store_tool` — store memories via typed tool calls
- :func:`memoclaw_recall_tool` — recall semantic memories from MemoClaw
- :class:`MemoClawDeps` — dependency carrier for injecting a ``MemoClaw`` client

Example::

    from pydantic_ai import Agent
    from memoclaw import MemoClaw
    from memoclaw.integrations.pydantic_ai import (
        MemoClawDeps,
        memoclaw_store_tool,
        memoclaw_recall_tool,
    )

    agent = Agent(
        "gpt-4o-mini",
        deps=MemoClawDeps(client=MemoClaw(), namespace="support"),
        tools=[
            memoclaw_store_tool(),
            memoclaw_recall_tool(top_k=8),
        ],
    )

    # Tools can now be called directly by the model
    result = agent.run_sync("Remember that Maria prefers dark mode and vim")
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Sequence

from pydantic import BaseModel, Field

try:  # pragma: no cover - exercised in import tests
    from pydantic_ai import RunContext, Tool
except ImportError as exc:  # pragma: no cover
    raise ImportError(
        "Pydantic AI integration requires the 'pydantic-ai' package. "
        "Install it with: pip install memoclaw[pydantic-ai]"
    ) from exc

from memoclaw.client import MemoClaw
from memoclaw.types import MemoryType


@dataclass(slots=True)
class MemoClawDeps:
    """Dependency object injected into ``RunContext.deps`` for Pydantic AI agents.

    Args:
        client: Configured :class:`~memoclaw.MemoClaw` instance.
        namespace: Default namespace to use when a tool call omits one.
        session_id: Default session identifier applied to store/recall calls.
        agent_id: Default agent identifier applied to store/recall calls.
        tags: Default tags injected into store calls when none are provided.
    """

    client: MemoClaw
    namespace: str | None = None
    session_id: str | None = None
    agent_id: str | None = None
    tags: tuple[str, ...] | None = None


class StoreMemoryParams(BaseModel):
    """Parameters accepted by :func:`memoclaw_store_tool`."""

    model_config = {
        "extra": "forbid",
    }

    content: str = Field(..., description="Memory content to persist.")
    importance: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="Optional importance score between 0 and 1.",
    )
    tags: list[str] | None = Field(
        default=None,
        description="Tags that categorize the memory.",
    )
    namespace: str | None = Field(
        default=None,
        description="MemoClaw namespace. Defaults to MemoClawDeps.namespace.",
    )
    session_id: str | None = Field(
        default=None,
        description="Conversation/session identifier.",
    )
    agent_id: str | None = Field(
        default=None,
        description="Agent identifier used when storing memories.",
    )
    memory_type: MemoryType | None = Field(
        default=None,
        description="Optional memory type classification (preference, fact, etc).",
    )
    expires_at: str | None = Field(
        default=None,
        description="ISO-8601 timestamp when the memory should expire.",
    )
    pinned: bool | None = Field(
        default=None,
        description="Whether the memory should be pinned as a core memory.",
    )
    immutable: bool | None = Field(
        default=None,
        description="If true, the memory cannot be modified after creation.",
    )
    metadata: dict[str, Any] | None = Field(
        default=None,
        description="Custom metadata stored alongside the memory.",
    )


class RecallMemoryParams(BaseModel):
    """Parameters accepted by :func:`memoclaw_recall_tool`."""

    model_config = {
        "extra": "forbid",
    }

    query: str = Field(..., description="Semantic query to run against MemoClaw.")
    limit: int | None = Field(
        default=5,
        ge=1,
        le=50,
        description="Maximum number of memories to return.",
    )
    min_similarity: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="Minimum cosine similarity threshold (0-1).",
    )
    namespace: str | None = Field(
        default=None,
        description="Namespace filter. Defaults to MemoClawDeps.namespace.",
    )
    tags: list[str] | None = Field(
        default=None,
        description="Tag filter applied server-side.",
    )
    include_relations: bool | None = Field(
        default=None,
        description="Whether to include related memories in the response.",
    )
    session_id: str | None = Field(
        default=None,
        description="Session filter applied to recall.",
    )
    agent_id: str | None = Field(
        default=None,
        description="Agent filter applied to recall.",
    )
    after: str | None = Field(
        default=None,
        description="Return memories created after the given ISO timestamp.",
    )
    memory_type: MemoryType | None = Field(
        default=None,
        description="Filter by MemoClaw memory type.",
    )


def _merge_default(value: Any | None, fallback: Any | None) -> Any | None:
    return value if value is not None else fallback


def _merge_tags(
    provided: Sequence[str] | None,
    default: tuple[str, ...] | None,
) -> list[str] | None:
    if provided is not None:
        return list(provided)
    if default is not None:
        return list(default)
    return None


def memoclaw_store_tool(
    *,
    name: str = "memoclaw_store_memory",
    description: str | None = None,
) -> Tool[MemoClawDeps]:
    """Return a Pydantic AI tool that stores memories via :class:`MemoClaw`.

    Args:
        name: Optional tool name override.
        description: Optional custom description exposed to the model.
    """

    def _store_memory(
        ctx: RunContext[MemoClawDeps],
        params: StoreMemoryParams,
    ) -> dict[str, Any]:
        client = ctx.deps.client
        result = client.store(
            params.content,
            importance=params.importance,
            tags=_merge_tags(params.tags, ctx.deps.tags),
            namespace=_merge_default(params.namespace, ctx.deps.namespace),
            session_id=_merge_default(params.session_id, ctx.deps.session_id),
            agent_id=_merge_default(params.agent_id, ctx.deps.agent_id),
            memory_type=params.memory_type,
            expires_at=params.expires_at,
            pinned=params.pinned,
            immutable=params.immutable,
            metadata=params.metadata,
        )
        return result.model_dump()

    return Tool(
        _store_memory,
        name=name,
        description=description
        or "Store new long-term memories inside MemoClaw for future recall.",
    )


def memoclaw_recall_tool(
    *,
    name: str = "memoclaw_recall_memories",
    description: str | None = None,
) -> Tool[MemoClawDeps]:
    """Return a Pydantic AI tool that recalls memories from MemoClaw."""

    def _recall_memories(
        ctx: RunContext[MemoClawDeps],
        params: RecallMemoryParams,
    ) -> dict[str, Any]:
        client = ctx.deps.client
        response = client.recall(
            params.query,
            limit=params.limit,
            min_similarity=params.min_similarity,
            namespace=_merge_default(params.namespace, ctx.deps.namespace),
            tags=params.tags,
            include_relations=params.include_relations,
            session_id=_merge_default(params.session_id, ctx.deps.session_id),
            agent_id=_merge_default(params.agent_id, ctx.deps.agent_id),
            after=params.after,
            memory_type=params.memory_type,
        )
        return response.model_dump()

    return Tool(
        _recall_memories,
        name=name,
        description=description
        or "Recall relevant MemoClaw memories to ground conversations.",
    )


__all__ = [
    "MemoClawDeps",
    "StoreMemoryParams",
    "RecallMemoryParams",
    "memoclaw_store_tool",
    "memoclaw_recall_tool",
]
