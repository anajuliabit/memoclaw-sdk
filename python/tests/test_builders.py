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


# ── Tests from PR: builder classes with client integration ──

import respx
import httpx

from memoclaw.builders import (
    AsyncMemoryFilter,
    AsyncRecallQuery,
    BatchStore,
    MemoryFilter,
    RecallQuery,
    RelationBuilder,
)

# Test private key
TEST_PRIVATE_KEY = "0x4c0883a69102937d6231471b5dbb6204fe512961708279f15a8f7e20b4e3b1fb"
BASE_URL = "https://api.memoclaw.com"

@pytest.fixture
def client():
    c = MemoClaw(private_key=TEST_PRIVATE_KEY, base_url=BASE_URL)
    yield c
    c.close()


@pytest.fixture
def async_client():
    return AsyncMemoClaw(private_key=TEST_PRIVATE_KEY, base_url=BASE_URL)


class TestRecallQuery:
    """Tests for RecallQuery builder."""

    @respx.mock
    def test_basic_recall(self, client: MemoClaw):
        """Test basic recall with query only."""
        respx.post(f"{BASE_URL}/v1/recall").mock(
            return_value=httpx.Response(
                200,
                json={
                    "memories": [
                        {
                            "id": "m1",
                            "content": "User prefers Python",
                            "similarity": 0.95,
                            "metadata": {},
                            "importance": 0.8,
                            "memory_type": "preference",
                            "namespace": "default",
                            "session_id": None,
                            "agent_id": None,
                            "created_at": "2025-01-01T00:00:00Z",
                            "access_count": 1,
                        }
                    ],
                    "query_tokens": 5,
                },
            )
        )
        
        result = (RecallQuery(client)
            .with_query("programming language preferences")
            .execute())
        
        assert len(result.memories) == 1
        assert result.memories[0].content == "User prefers Python"

    @respx.mock
    def test_recall_with_filters(self, client: MemoClaw):
        """Test recall with multiple filters."""
        respx.post(f"{BASE_URL}/v1/recall").mock(
            return_value=httpx.Response(
                200,
                json={"memories": [], "query_tokens": 5},
            )
        )
        
        result = (RecallQuery(client)
            .with_query("preferences")
            .with_limit(10)
            .with_min_similarity(0.7)
            .with_namespace("user-prefs")
            .with_tags(["important"])
            .with_session_id("session-123")
            .with_memory_type("preference")
            .include_relations()
            .execute())
        
        assert result is not None

    def test_recall_without_query_raises(self, client: MemoClaw):
        """Test that executing without query raises ValueError."""
        with pytest.raises(ValueError, match="Query is required"):
            RecallQuery(client).execute()

    def test_invalid_similarity_raises(self, client: MemoClaw):
        """Test that invalid similarity raises ValueError."""
        with pytest.raises(ValueError, match="min_similarity must be between"):
            RecallQuery(client).with_min_similarity(1.5)


class TestAsyncRecallQuery:
    """Tests for AsyncRecallQuery builder."""

    @respx.mock
    @pytest.mark.asyncio
    async def test_async_recall(self, async_client: AsyncMemoClaw):
        """Test async recall query."""
        respx.post(f"{BASE_URL}/v1/recall").mock(
            return_value=httpx.Response(
                200,
                json={"memories": [], "query_tokens": 5},
            )
        )
        
        result = await (AsyncRecallQuery(async_client)
            .with_query("test")
            .execute())
        
        assert result is not None


class TestMemoryFilter:
    """Tests for MemoryFilter builder."""

    @respx.mock
    def test_iter_memories(self, client: MemoClaw):
        """Test iterating over memories with filters."""
        mem_json = lambda i: {
            "id": f"m{i}",
            "user_id": "u1",
            "namespace": "default",
            "content": f"mem {i}",
            "embedding_model": "text-embedding-3-small",
            "metadata": {},
            "importance": 0.5,
            "memory_type": "general",
            "session_id": None,
            "agent_id": None,
            "created_at": "2025-01-01T00:00:00Z",
            "updated_at": "2025-01-01T00:00:00Z",
            "accessed_at": "2025-01-01T00:00:00Z",
            "access_count": 0,
            "deleted_at": None,
            "expires_at": None,
            "pinned": False,
        }
        
        respx.get(f"{BASE_URL}/v1/memories").mock(
            side_effect=[
                httpx.Response(200, json={
                    "memories": [mem_json(1)],
                    "total": 1,
                    "limit": 50,
                    "offset": 0,
                }),
            ]
        )
        
        memories = list(MemoryFilter(client)
            .with_namespace("default")
            .iter_memories())
        
        assert len(memories) == 1

    @respx.mock
    def test_count(self, client: MemoClaw):
        """Test counting memories."""
        respx.get(f"{BASE_URL}/v1/memories").mock(
            return_value=httpx.Response(
                200,
                json={
                    "memories": [],
                    "total": 42,
                    "limit": 1,
                    "offset": 0,
                },
            )
        )
        
        count = MemoryFilter(client).with_namespace("test").count()
        assert count == 42

    def test_invalid_batch_size_raises(self, client: MemoClaw):
        """Test that invalid batch size raises ValueError."""
        with pytest.raises(ValueError, match="batch_size must be positive"):
            MemoryFilter(client).with_batch_size(0)


class TestAsyncMemoryFilter:
    """Tests for AsyncMemoryFilter builder."""

    @respx.mock
    @pytest.mark.asyncio
    async def test_async_iter_memories(self, async_client: AsyncMemoClaw):
        """Test async iteration over memories."""
        respx.get(f"{BASE_URL}/v1/memories").mock(
            return_value=httpx.Response(
                200,
                json={
                    "memories": [],
                    "total": 0,
                    "limit": 50,
                    "offset": 0,
                },
            )
        )
        
        memories = [m async for m in AsyncMemoryFilter(async_client).iter_memories()]
        assert memories == []


class TestRelationBuilder:
    """Tests for RelationBuilder."""

    @respx.mock
    def test_create_single_relation(self, client: MemoClaw):
        """Test creating a single relation."""
        respx.post(f"{BASE_URL}/v1/memories/m1/relations").mock(
            return_value=httpx.Response(
                201,
                json={
                    "id": "rel1",
                    "source_id": "m1",
                    "target_id": "m2",
                    "relation_type": "related_to",
                    "metadata": {},
                    "created_at": "2025-01-01T00:00:00Z",
                },
            )
        )
        
        result = (RelationBuilder(client, "m1")
            .relate_to("m2", "related_to")
            .create_all())
        
        assert len(result) == 1
        assert result[0]["target_id"] == "m2"

    @respx.mock
    def test_create_multiple_relations(self, client: MemoClaw):
        """Test creating multiple relations."""
        respx.post(f"{BASE_URL}/v1/memories/m1/relations").mock(
            side_effect=[
                httpx.Response(
                    201,
                    json={
                        "id": f"rel{i}",
                        "source_id": "m1",
                        "target_id": f"m{i}",
                        "relation_type": "related_to",
                        "metadata": {},
                        "created_at": "2025-01-01T00:00:00Z",
                    },
                )
                for i in range(2, 5)
            ]
        )
        
        result = (RelationBuilder(client, "m1")
            .relate_to("m2", "related_to")
            .relate_to("m3", "supports")
            .relate_to("m4", "contradicts")
            .create_all())
        
        assert len(result) == 3


class TestBatchStore:
    """Tests for BatchStore."""

    @respx.mock
    def test_add_single_memory(self, client: MemoClaw):
        """Test adding a single memory to batch."""
        respx.post(f"{BASE_URL}/v1/store/batch").mock(
            return_value=httpx.Response(
                201,
                json={
                    "ids": ["mem-1"],
                    "stored": True,
                    "count": 1,
                    "deduplicated_count": 0,
                    "tokens_used": 10,
                },
            )
        )
        
        store = BatchStore(client)
        store.add("Test memory", importance=0.5)
        
        assert store.count() == 1
        result = store.execute()
        
        assert result["count"] == 1
        assert "mem-1" in result["ids"]

    @respx.mock
    def test_add_many_memories(self, client: MemoClaw):
        """Test adding many memories."""
        respx.post(f"{BASE_URL}/v1/store/batch").mock(
            return_value=httpx.Response(
                201,
                json={
                    "ids": ["mem-1", "mem-2"],
                    "stored": True,
                    "count": 2,
                    "deduplicated_count": 0,
                    "tokens_used": 20,
                },
            )
        )
        
        store = BatchStore(client)
        store.add_many([
            {"content": "Memory 1"},
            {"content": "Memory 2"},
        ])
        
        assert store.count() == 2
        result = store.execute()
        
        assert result["count"] == 2

    @respx.mock
    def test_auto_chunking_large_batch(self, client: MemoClaw):
        """Test automatic chunking for large batches."""
        # Create 150 memories - should be split into 2 batches
        memories = [{"content": f"Memory {i}"} for i in range(150)]
        
        respx.post(f"{BASE_URL}/v1/store/batch").mock(
            side_effect=[
                httpx.Response(
                    201,
                    json={
                        "ids": [f"mem-{i}" for i in range(100)],
                        "stored": True,
                        "count": 100,
                        "deduplicated_count": 0,
                        "tokens_used": 1000,
                    },
                ),
                httpx.Response(
                    201,
                    json={
                        "ids": [f"mem-{i}" for i in range(100, 150)],
                        "stored": True,
                        "count": 50,
                        "deduplicated_count": 0,
                        "tokens_used": 500,
                    },
                ),
            ]
        )
        
        store = BatchStore(client)
        store.add_many(memories)
        
        result = store.execute()
        
        assert result["count"] == 150
        assert result["tokens_used"] == 1500

    def test_empty_batch(self, client: MemoClaw):
        """Test executing empty batch."""
        store = BatchStore(client)
        result = store.execute()
        
        assert result["count"] == 0
        assert result["ids"] == []
