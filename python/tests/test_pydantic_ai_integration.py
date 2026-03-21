"""Tests for the Pydantic AI integration helpers."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

pydantic_ai = pytest.importorskip("pydantic_ai")
from pydantic_ai import RunContext

from memoclaw.integrations.pydantic_ai import (
    MemoClawDeps,
    RecallMemoryParams,
    StoreMemoryParams,
    memoclaw_recall_tool,
    memoclaw_store_tool,
)


def _make_ctx(**deps_kwargs: object) -> RunContext[MemoClawDeps]:
    deps = MemoClawDeps(**deps_kwargs)
    return RunContext(deps=deps, model=MagicMock(), usage=MagicMock())


class TestStoreTool:
    def test_store_uses_defaults(self):
        client = MagicMock()
        client.store.return_value.model_dump.return_value = {"id": "mem-123"}

        tool = memoclaw_store_tool()
        ctx = _make_ctx(
            client=client,
            namespace="support",
            session_id="sess-1",
            agent_id="agent-7",
            tags=("default",),
        )

        payload = StoreMemoryParams(content="User prefers dark mode")
        result = tool.function(ctx, payload)

        assert result == {"id": "mem-123"}
        client.store.assert_called_once_with(
            "User prefers dark mode",
            importance=None,
            tags=["default"],
            namespace="support",
            session_id="sess-1",
            agent_id="agent-7",
            memory_type=None,
            expires_at=None,
            pinned=None,
            immutable=None,
            metadata=None,
        )

    def test_store_overrides_defaults(self):
        client = MagicMock()
        client.store.return_value.model_dump.return_value = {"id": "mem-456"}

        tool = memoclaw_store_tool()
        ctx = _make_ctx(client=client, namespace="support", tags=("default",))

        payload = StoreMemoryParams(
            content="Important fact",
            namespace="research",
            tags=["custom"],
            importance=0.9,
            session_id="sess-2",
            agent_id="agent-9",
            pinned=True,
            metadata={"topic": "ux"},
        )
        tool.function(ctx, payload)

        client.store.assert_called_once_with(
            "Important fact",
            importance=0.9,
            tags=["custom"],
            namespace="research",
            session_id="sess-2",
            agent_id="agent-9",
            memory_type=None,
            expires_at=None,
            pinned=True,
            immutable=None,
            metadata={"topic": "ux"},
        )


class TestRecallTool:
    def test_recall_uses_defaults(self):
        client = MagicMock()
        client.recall.return_value.model_dump.return_value = {
            "memories": [],
            "query_tokens": 12,
        }

        tool = memoclaw_recall_tool()
        ctx = _make_ctx(
            client=client,
            namespace="support",
            session_id="sess-1",
            agent_id="agent-7",
        )

        payload = RecallMemoryParams(query="preferences")
        result = tool.function(ctx, payload)

        assert result["memories"] == []
        client.recall.assert_called_once_with(
            "preferences",
            limit=5,
            min_similarity=None,
            namespace="support",
            tags=None,
            include_relations=None,
            session_id="sess-1",
            agent_id="agent-7",
            after=None,
            memory_type=None,
        )

    def test_recall_overrides(self):
        client = MagicMock()
        client.recall.return_value.model_dump.return_value = {
            "memories": [
                {"id": "mem-1", "content": "something"},
            ],
            "query_tokens": 5,
        }

        tool = memoclaw_recall_tool(name="custom_name")
        ctx = _make_ctx(client=client, namespace="support")

        payload = RecallMemoryParams(
            query="recent decisions",
            limit=10,
            tags=["decisions"],
            include_relations=True,
            namespace="product",
            after="2026-03-01T00:00:00Z",
        )
        result = tool.function(ctx, payload)

        assert result["memories"][0]["id"] == "mem-1"
        client.recall.assert_called_once_with(
            "recent decisions",
            limit=10,
            min_similarity=None,
            namespace="product",
            tags=["decisions"],
            include_relations=True,
            session_id=None,
            agent_id=None,
            after="2026-03-01T00:00:00Z",
            memory_type=None,
        )
