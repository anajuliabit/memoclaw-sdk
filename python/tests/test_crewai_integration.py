"""Tests for the CrewAI integration module.

These tests mock the crewai dependency so we don't need it installed at test time.
"""

from __future__ import annotations

import json
import sys
import types
from unittest.mock import MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Mock crewai.tools.BaseTool before importing the integration module
# ---------------------------------------------------------------------------

class _FakeBaseTool:
    """Minimal stand-in for crewai.tools.BaseTool."""

    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__(**kwargs)

    def __init__(self, **kwargs):
        for key, value in kwargs.items():
            setattr(self, key, value)


@pytest.fixture(autouse=True)
def _mock_crewai(monkeypatch):
    """Inject a fake crewai module so the integration can be imported."""
    crewai_mod = types.ModuleType("crewai")
    tools_mod = types.ModuleType("crewai.tools")

    # We need BaseTool to be a proper Pydantic-compatible base.
    # Since the real integration uses Pydantic model features, we use a
    # minimal shim that the Pydantic metaclass can work with.
    from pydantic import BaseModel

    class FakeBaseTool(BaseModel):
        """Minimal shim matching the crewai BaseTool interface."""

        model_config = {"arbitrary_types_allowed": True}

    tools_mod.BaseTool = FakeBaseTool
    crewai_mod.tools = tools_mod

    monkeypatch.setitem(sys.modules, "crewai", crewai_mod)
    monkeypatch.setitem(sys.modules, "crewai.tools", tools_mod)

    yield

    # Clean up cached import of our integration module so each test is fresh
    sys.modules.pop("memoclaw.integrations.crewai", None)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_store_response(**overrides):
    """Return a mock store response."""
    defaults = {
        "id": "mem_abc123",
        "content": "test content",
        "importance": 0.8,
        "tags": ["test"],
        "namespace": "default",
        "created_at": "2026-01-01T00:00:00Z",
    }
    defaults.update(overrides)
    mock = MagicMock()
    mock.model_dump.return_value = defaults
    return mock


def _make_recall_response(memories=None):
    """Return a mock recall response."""
    mock = MagicMock()
    mock.model_dump.return_value = {
        "memories": memories or [],
        "query": "test query",
        "total": len(memories or []),
    }
    return mock


# ---------------------------------------------------------------------------
# Store tool tests
# ---------------------------------------------------------------------------

class TestMemoClawStoreTool:
    def test_store_basic(self):
        from memoclaw.integrations.crewai import MemoClawStoreTool

        client = MagicMock()
        client.store.return_value = _make_store_response()

        tool = MemoClawStoreTool(client=client, namespace="test-ns")
        result = tool._run(content="User likes dark mode")

        client.store.assert_called_once_with(
            "User likes dark mode",
            importance=None,
            tags=None,
            namespace="test-ns",
            session_id=None,
            agent_id=None,
        )
        parsed = json.loads(result)
        assert parsed["id"] == "mem_abc123"

    def test_store_with_importance_and_tags(self):
        from memoclaw.integrations.crewai import MemoClawStoreTool

        client = MagicMock()
        client.store.return_value = _make_store_response(importance=0.9, tags=["pref"])

        tool = MemoClawStoreTool(client=client)
        result = tool._run(content="Prefers vim", importance=0.9, tags=["pref"])

        client.store.assert_called_once_with(
            "Prefers vim",
            importance=0.9,
            tags=["pref"],
            namespace=None,
            session_id=None,
            agent_id=None,
        )
        parsed = json.loads(result)
        assert parsed["importance"] == 0.9

    def test_store_uses_default_tags(self):
        from memoclaw.integrations.crewai import MemoClawStoreTool

        client = MagicMock()
        client.store.return_value = _make_store_response()

        tool = MemoClawStoreTool(
            client=client,
            default_tags=["auto", "agent"],
        )
        tool._run(content="Some fact")

        call_kwargs = client.store.call_args
        assert call_kwargs.kwargs.get("tags") == ["auto", "agent"] or \
               call_kwargs[1].get("tags") == ["auto", "agent"]

    def test_store_explicit_tags_override_defaults(self):
        from memoclaw.integrations.crewai import MemoClawStoreTool

        client = MagicMock()
        client.store.return_value = _make_store_response()

        tool = MemoClawStoreTool(
            client=client,
            default_tags=["auto"],
        )
        tool._run(content="Some fact", tags=["explicit"])

        call_kwargs = client.store.call_args
        assert call_kwargs.kwargs.get("tags") == ["explicit"] or \
               call_kwargs[1].get("tags") == ["explicit"]

    def test_store_passes_session_and_agent_ids(self):
        from memoclaw.integrations.crewai import MemoClawStoreTool

        client = MagicMock()
        client.store.return_value = _make_store_response()

        tool = MemoClawStoreTool(
            client=client,
            session_id="sess-1",
            agent_id="agent-1",
        )
        tool._run(content="test")

        _, kwargs = client.store.call_args
        assert kwargs["session_id"] == "sess-1"
        assert kwargs["agent_id"] == "agent-1"


# ---------------------------------------------------------------------------
# Recall tool tests
# ---------------------------------------------------------------------------

class TestMemoClawRecallTool:
    def test_recall_basic(self):
        from memoclaw.integrations.crewai import MemoClawRecallTool

        memories = [
            {"id": "mem_1", "content": "Likes dark mode", "similarity": 0.92},
        ]
        client = MagicMock()
        client.recall.return_value = _make_recall_response(memories)

        tool = MemoClawRecallTool(client=client, namespace="test-ns")
        result = tool._run(query="user preferences")

        client.recall.assert_called_once_with(
            "user preferences",
            limit=5,
            min_similarity=None,
            namespace="test-ns",
            tags=None,
            session_id=None,
            agent_id=None,
        )
        parsed = json.loads(result)
        assert len(parsed["memories"]) == 1

    def test_recall_with_filters(self):
        from memoclaw.integrations.crewai import MemoClawRecallTool

        client = MagicMock()
        client.recall.return_value = _make_recall_response([])

        tool = MemoClawRecallTool(client=client)
        tool._run(
            query="preferences",
            limit=10,
            min_similarity=0.8,
            tags=["pref"],
        )

        client.recall.assert_called_once_with(
            "preferences",
            limit=10,
            min_similarity=0.8,
            namespace=None,
            tags=["pref"],
            session_id=None,
            agent_id=None,
        )

    def test_recall_passes_session_and_agent_ids(self):
        from memoclaw.integrations.crewai import MemoClawRecallTool

        client = MagicMock()
        client.recall.return_value = _make_recall_response([])

        tool = MemoClawRecallTool(
            client=client,
            session_id="sess-2",
            agent_id="agent-2",
        )
        tool._run(query="test")

        _, kwargs = client.recall.call_args
        assert kwargs["session_id"] == "sess-2"
        assert kwargs["agent_id"] == "agent-2"

    def test_recall_custom_name_and_description(self):
        from memoclaw.integrations.crewai import MemoClawRecallTool

        client = MagicMock()
        tool = MemoClawRecallTool(
            client=client,
            name="custom_recall",
            description="Custom desc",
        )
        assert tool.name == "custom_recall"
        assert tool.description == "Custom desc"


# ---------------------------------------------------------------------------
# Import guard test
# ---------------------------------------------------------------------------

class TestImportGuard:
    def test_raises_without_crewai(self, monkeypatch):
        """When crewai is not installed, importing should raise ImportError."""
        # Remove the mocked crewai modules
        monkeypatch.delitem(sys.modules, "crewai", raising=False)
        monkeypatch.delitem(sys.modules, "crewai.tools", raising=False)
        sys.modules.pop("memoclaw.integrations.crewai", None)

        with pytest.raises(ImportError, match="crewai"):
            from memoclaw.integrations.crewai import MemoClawStoreTool  # noqa: F401
