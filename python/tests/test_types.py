"""Tests for Pydantic model validation."""

import pytest
from pydantic import ValidationError

from memoclaw.types import (
    ClusterInfo,
    ConsolidateResult,
    DeleteResult,
    ExtractResult,
    FreeTierStatus,
    IngestResult,
    ListResponse,
    Memory,
    RecallMemory,
    RecallResponse,
    Relation,
    RelationWithMemory,
    RelationsResponse,
    StoreBatchResult,
    StoreInput,
    StoreResult,
    SuggestedMemory,
    SuggestedResponse,
)


class TestStoreResult:
    def test_valid(self):
        r = StoreResult(id="abc-123", stored=True, deduplicated=False, tokens_used=42)
        assert r.id == "abc-123"
        assert r.stored is True
        assert r.deduplicated is False
        assert r.tokens_used == 42

    def test_missing_required(self):
        with pytest.raises(ValidationError):
            StoreResult(id="abc")  # type: ignore[call-arg]


class TestStoreBatchResult:
    def test_valid(self):
        r = StoreBatchResult(
            ids=["a", "b"],
            stored=True,
            count=2,
            deduplicated_count=0,
            tokens_used=80,
        )
        assert len(r.ids) == 2
        assert r.count == 2


class TestMemory:
    def test_full(self):
        m = Memory(
            id="m1",
            user_id="u1",
            namespace="default",
            content="hello",
            embedding_model="text-embedding-3-small",
            metadata={"tags": ["test"]},
            importance=0.5,
            memory_type="general",
            session_id=None,
            agent_id=None,
            created_at="2025-01-01T00:00:00Z",
            updated_at="2025-01-01T00:00:00Z",
            accessed_at="2025-01-01T00:00:00Z",
            access_count=0,
        )
        assert m.memory_type == "general"
        assert m.deleted_at is None
        assert m.expires_at is None

    def test_with_optional_fields(self):
        m = Memory(
            id="m1",
            user_id="u1",
            namespace="default",
            content="hello",
            embedding_model="text-embedding-3-small",
            metadata={},
            importance=0.5,
            memory_type="correction",
            created_at="2025-01-01T00:00:00Z",
            updated_at="2025-01-01T00:00:00Z",
            accessed_at="2025-01-01T00:00:00Z",
            access_count=3,
            deleted_at="2025-06-01T00:00:00Z",
            expires_at="2025-12-01T00:00:00Z",
        )
        assert m.deleted_at == "2025-06-01T00:00:00Z"
        assert m.expires_at == "2025-12-01T00:00:00Z"


class TestRecallMemory:
    def test_without_relations(self):
        rm = RecallMemory(
            id="r1",
            content="test",
            similarity=0.92,
            metadata={},
            importance=0.7,
            memory_type="preference",
            namespace="default",
            created_at="2025-01-01T00:00:00Z",
            access_count=5,
        )
        assert rm.relations is None


class TestRecallResponse:
    def test_valid(self):
        r = RecallResponse(
            memories=[
                RecallMemory(
                    id="r1",
                    content="test",
                    similarity=0.92,
                    metadata={},
                    importance=0.7,
                    memory_type="preference",
                    namespace="default",
                    created_at="2025-01-01T00:00:00Z",
                    access_count=5,
                )
            ],
            query_tokens=10,
        )
        assert len(r.memories) == 1
        assert r.query_tokens == 10


class TestListResponse:
    def test_valid(self):
        r = ListResponse(memories=[], total=0, limit=20, offset=0)
        assert r.total == 0


class TestDeleteResult:
    def test_with_id(self):
        r = DeleteResult(deleted=True, id="d1")
        assert r.deleted is True
        assert r.id == "d1"

    def test_without_id(self):
        r = DeleteResult(deleted=True)
        assert r.id is None


class TestIngestResult:
    def test_valid(self):
        r = IngestResult(
            memory_ids=["a", "b"],
            facts_extracted=3,
            facts_stored=2,
            facts_deduplicated=1,
            relations_created=1,
            tokens_used=150,
        )
        assert r.facts_extracted == 3


class TestExtractResult:
    def test_valid(self):
        r = ExtractResult(
            memory_ids=["a"],
            facts_extracted=1,
            facts_stored=1,
            facts_deduplicated=0,
            tokens_used=50,
        )
        assert r.facts_stored == 1


class TestConsolidateResult:
    def test_valid(self):
        r = ConsolidateResult(
            clusters_found=2,
            memories_merged=4,
            memories_created=2,
            clusters=[
                ClusterInfo(memory_ids=["a", "b"], similarity=0.92, merged_into="c"),
                ClusterInfo(memory_ids=["d", "e"], similarity=0.88),
            ],
        )
        assert r.clusters_found == 2
        assert r.clusters[0].merged_into == "c"
        assert r.clusters[1].merged_into is None


class TestRelation:
    def test_valid(self):
        r = Relation(
            id="rel1",
            source_id="s1",
            target_id="t1",
            relation_type="related_to",
            metadata={},
            created_at="2025-01-01T00:00:00Z",
        )
        assert r.relation_type == "related_to"


class TestRelationWithMemory:
    def test_valid(self):
        r = RelationWithMemory(
            id="rel1",
            relation_type="supports",
            direction="outgoing",
            memory={
                "id": "m2",
                "content": "related",
                "importance": 0.5,
                "memory_type": "general",
                "namespace": "default",
            },
            metadata={},
            created_at="2025-01-01T00:00:00Z",
        )
        assert r.direction == "outgoing"
        assert r.memory.id == "m2"


class TestRelationsResponse:
    def test_valid(self):
        r = RelationsResponse(relations=[])
        assert len(r.relations) == 0


class TestSuggestedMemory:
    def test_valid(self):
        s = SuggestedMemory(
            id="s1",
            content="test",
            metadata={},
            importance=0.8,
            memory_type="general",
            namespace="default",
            created_at="2025-01-01T00:00:00Z",
            accessed_at="2025-01-01T00:00:00Z",
            access_count=10,
            relation_count=2,
            category="hot",
            review_score=0.9,
        )
        assert s.category == "hot"


class TestSuggestedResponse:
    def test_valid(self):
        r = SuggestedResponse(
            suggested=[], categories={"hot": 5, "stale": 3}, total=8
        )
        assert r.total == 8


class TestFreeTierStatus:
    def test_valid(self):
        s = FreeTierStatus(
            wallet="0xabc",
            free_tier_remaining=950,
            free_tier_total=1000,
            free_tier_used=50,
        )
        assert s.free_tier_remaining == 950


class TestStoreInput:
    def test_minimal(self):
        si = StoreInput(content="hello")
        assert si.content == "hello"
        assert si.importance is None

    def test_full(self):
        si = StoreInput(
            content="hello",
            importance=0.8,
            tags=["a", "b"],
            namespace="ns",
            memory_type="preference",
            session_id="sess1",
            agent_id="agent1",
            expires_at="2025-12-01T00:00:00Z",
        )
        d = si.model_dump(exclude_none=True)
        assert "content" in d
        assert d["tags"] == ["a", "b"]
