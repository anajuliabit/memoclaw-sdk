"""Tests for builder patterns."""

import pytest

from memoclaw import MemoryBuilder, RecallBuilder, StoreInput


class TestMemoryBuilder:
    def test_basic_builder(self):
        builder = MemoryBuilder()
        memory = builder.content("Test memory").build()
        
        assert isinstance(memory, StoreInput)
        assert memory.content == "Test memory"

    def test_full_builder(self):
        memory = (
            MemoryBuilder()
            .content("User prefers dark mode")
            .importance(0.9)
            .tags(["preferences", "ui"])
            .namespace("app-settings")
            .memory_type("preference")
            .pinned(True)
            .build()
        )
        
        assert memory.content == "User prefers dark mode"
        assert memory.importance == 0.9
        assert memory.tags == ["preferences", "ui"]
        assert memory.namespace == "app-settings"
        assert memory.memory_type == "preference"
        assert memory.pinned is True

    def test_add_tag(self):
        memory = (
            MemoryBuilder()
            .content("Test")
            .add_tag("tag1")
            .add_tag("tag2")
            .build()
        )
        assert memory.tags == ["tag1", "tag2"]

    def test_add_metadata(self):
        memory = (
            MemoryBuilder()
            .content("Test")
            .add_metadata("key1", "value1")
            .add_metadata("key2", 42)
            .build()
        )
        assert memory.metadata == {"key1": "value1", "key2": 42}

    def test_set_metadata(self):
        memory = (
            MemoryBuilder()
            .content("Test")
            .metadata({"custom": "data"})
            .build()
        )
        assert memory.metadata == {"custom": "data"}

    def test_expires_in_days(self):
        memory = (
            MemoryBuilder()
            .content("Test")
            .expires_in_days(7)
            .build()
        )
        assert memory.expires_at is not None
        assert memory.expires_at.endswith("Z")

    def test_importance_validation_high(self):
        with pytest.raises(ValueError, match="between 0.0 and 1.0"):
            MemoryBuilder().content("Test").importance(1.5)

    def test_importance_validation_low(self):
        with pytest.raises(ValueError, match="between 0.0 and 1.0"):
            MemoryBuilder().content("Test").importance(-0.1)

    def test_build_requires_content(self):
        with pytest.raises(ValueError, match="content is required"):
            MemoryBuilder().build()

    def test_to_dict(self):
        result = (
            MemoryBuilder()
            .content("Test memory")
            .importance(0.8)
            .to_dict()
        )
        assert result == {
            "content": "Test memory",
            "importance": 0.8,
        }


class TestRecallBuilder:
    def test_basic_recall(self):
        params = RecallBuilder().query("search term").build()
        
        assert params == {"query": "search term"}

    def test_full_recall(self):
        params = (
            RecallBuilder()
            .query("dark mode preferences")
            .limit(10)
            .min_similarity(0.7)
            .namespace("app-settings")
            .session("sess-123")
            .agent("agent-456")
            .include_relations(True)
            .build()
        )
        
        assert params["query"] == "dark mode preferences"
        assert params["limit"] == 10
        assert params["min_similarity"] == 0.7
        assert params["namespace"] == "app-settings"
        assert params["session_id"] == "sess-123"
        assert params["agent_id"] == "agent-456"
        assert params["include_relations"] is True

    def test_recall_with_tags(self):
        params = (
            RecallBuilder()
            .query("test")
            .tags(["tag1", "tag2"])
            .build()
        )
        
        assert params["filters"]["tags"] == ["tag1", "tag2"]

    def test_recall_with_memory_type(self):
        params = (
            RecallBuilder()
            .query("test")
            .memory_type("preference")
            .build()
        )
        
        assert params["filters"]["memory_type"] == "preference"

    def test_recall_requires_query(self):
        with pytest.raises(ValueError, match="query is required"):
            RecallBuilder().build()

    def test_min_similarity_validation(self):
        with pytest.raises(ValueError, match="between 0.0 and 1.0"):
            RecallBuilder().query("test").min_similarity(1.1)
