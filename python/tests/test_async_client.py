"""Tests for AsyncMemoClaw client methods to improve coverage."""

from __future__ import annotations

import httpx
import pytest
import respx

from memoclaw import AsyncMemoClaw

TEST_PRIVATE_KEY = "0x4c0883a69102937d6231471b5dbb6204fe512961708279f15a8f7e20b4e3b1fb"
BASE_URL = "https://api.memoclaw.com"

_MEM_JSON = {
    "id": "mem-1",
    "user_id": "0x1234",
    "content": "test memory",
    "importance": 0.5,
    "namespace": "default",
    "memory_type": "general",
    "embedding_model": "text-embedding-3-small",
    "metadata": {},
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

_RECALL_MEM_JSON = {
    "id": "mem-1",
    "content": "test memory",
    "importance": 0.5,
    "namespace": "default",
    "memory_type": "general",
    "metadata": {},
    "session_id": None,
    "agent_id": None,
    "created_at": "2025-01-01T00:00:00Z",
    "access_count": 0,
    "pinned": False,
    "immutable": False,
    "similarity": 0.95,
}


@pytest.fixture
def client():
    return AsyncMemoClaw(private_key=TEST_PRIVATE_KEY, base_url=BASE_URL)


class TestAsyncRecall:
    @respx.mock
    @pytest.mark.asyncio
    async def test_recall_basic(self, client: AsyncMemoClaw):
        respx.post(f"{BASE_URL}/v1/recall").mock(
            return_value=httpx.Response(200, json={
                "memories": [_RECALL_MEM_JSON],
                "query_tokens": 10,
            })
        )
        result = await client.recall("test")
        assert len(result.memories) == 1
        assert result.memories[0].similarity == 0.95
        await client.close()

    @respx.mock
    @pytest.mark.asyncio
    async def test_recall_with_filters(self, client: AsyncMemoClaw):
        respx.post(f"{BASE_URL}/v1/recall").mock(
            return_value=httpx.Response(200, json={
                "memories": [],
                "query_tokens": 5,
            })
        )
        result = await client.recall(
            "test",
            limit=5,
            min_similarity=0.8,
            namespace="ns",
            tags=["tag1"],
            include_relations=True,
            session_id="sess-1",
            agent_id="agent-1",
            after="2025-01-01",
            memory_type="general",
        )
        assert len(result.memories) == 0
        await client.close()


class TestAsyncList:
    @respx.mock
    @pytest.mark.asyncio
    async def test_list_basic(self, client: AsyncMemoClaw):
        respx.get(f"{BASE_URL}/v1/memories").mock(
            return_value=httpx.Response(200, json={
                "memories": [_MEM_JSON],
                "total": 1,
                "limit": 50,
                "offset": 0,
            })
        )
        result = await client.list()
        assert result.total == 1
        assert result.memories[0].id == "mem-1"
        await client.close()


class TestAsyncGet:
    @respx.mock
    @pytest.mark.asyncio
    async def test_get(self, client: AsyncMemoClaw):
        respx.get(f"{BASE_URL}/v1/memories/mem-1").mock(
            return_value=httpx.Response(200, json=_MEM_JSON)
        )
        mem = await client.get("mem-1")
        assert mem.id == "mem-1"
        await client.close()


class TestAsyncUpdate:
    @respx.mock
    @pytest.mark.asyncio
    async def test_update(self, client: AsyncMemoClaw):
        respx.patch(f"{BASE_URL}/v1/memories/mem-1").mock(
            return_value=httpx.Response(200, json={**_MEM_JSON, "content": "updated"})
        )
        mem = await client.update("mem-1", content="updated", importance=0.9, pinned=True, immutable=True)
        assert mem.content == "updated"
        await client.close()

    @respx.mock
    @pytest.mark.asyncio
    async def test_update_with_all_fields(self, client: AsyncMemoClaw):
        respx.patch(f"{BASE_URL}/v1/memories/mem-1").mock(
            return_value=httpx.Response(200, json=_MEM_JSON)
        )
        mem = await client.update(
            "mem-1",
            content="new",
            metadata={"k": "v"},
            importance=0.5,
            memory_type="semantic",
            namespace="ns",
            pinned=True,
            immutable=False,
            expires_at="2025-12-31T00:00:00Z",
        )
        assert mem.id == "mem-1"
        await client.close()

    @respx.mock
    @pytest.mark.asyncio
    async def test_update_clear_expires(self, client: AsyncMemoClaw):
        respx.patch(f"{BASE_URL}/v1/memories/mem-1").mock(
            return_value=httpx.Response(200, json=_MEM_JSON)
        )
        mem = await client.update("mem-1", expires_at=None)
        assert mem.id == "mem-1"
        await client.close()


class TestAsyncDelete:
    @respx.mock
    @pytest.mark.asyncio
    async def test_delete(self, client: AsyncMemoClaw):
        respx.delete(f"{BASE_URL}/v1/memories/mem-1").mock(
            return_value=httpx.Response(200, json={"deleted": True})
        )
        result = await client.delete("mem-1")
        assert result.deleted is True
        await client.close()

    @respx.mock
    @pytest.mark.asyncio
    async def test_delete_batch(self, client: AsyncMemoClaw):
        respx.post(f"{BASE_URL}/v1/memories/batch-delete").mock(
            return_value=httpx.Response(200, json={
                "results": [
                    {"id": "mem-1", "deleted": True},
                    {"id": "mem-2", "deleted": True},
                ]
            })
        )
        results = await client.delete_batch(["mem-1", "mem-2"])
        assert len(results) == 2
        await client.close()

    @respx.mock
    @pytest.mark.asyncio
    async def test_delete_batch_empty(self, client: AsyncMemoClaw):
        with pytest.raises(ValueError, match="memory_ids list must not be empty"):
            await client.delete_batch([])
        await client.close()


class TestAsyncStoreBatch:
    @respx.mock
    @pytest.mark.asyncio
    async def test_store_batch(self, client: AsyncMemoClaw):
        respx.post(f"{BASE_URL}/v1/store/batch").mock(
            return_value=httpx.Response(201, json={
                "ids": ["id1", "id2"],
                "stored": True,
                "count": 2,
                "deduplicated_count": 0,
                "tokens_used": 50,
            })
        )
        result = await client.store_batch([
            {"content": "mem1"},
            {"content": "mem2"},
        ])
        assert result.count == 2
        await client.close()

    @pytest.mark.asyncio
    async def test_store_batch_empty_raises(self, client: AsyncMemoClaw):
        with pytest.raises(ValueError, match="must not be empty"):
            await client.store_batch([])
        await client.close()

    @pytest.mark.asyncio
    async def test_store_batch_too_large(self, client: AsyncMemoClaw):
        with pytest.raises(ValueError, match="exceeds maximum"):
            await client.store_batch([{"content": f"m{i}"} for i in range(101)])
        await client.close()


class TestAsyncIngest:
    @respx.mock
    @pytest.mark.asyncio
    async def test_ingest_messages(self, client: AsyncMemoClaw):
        respx.post(f"{BASE_URL}/v1/ingest").mock(
            return_value=httpx.Response(200, json={
                "memory_ids": ["m1", "m2"],
                "facts_extracted": 2,
                "facts_stored": 2,
                "facts_deduplicated": 0,
                "relations_created": 0, "tokens_used": 30,
            })
        )
        result = await client.ingest(
            messages=[{"role": "user", "content": "hello"}],
            namespace="ns",
            session_id="s",
            agent_id="a",
            auto_relate=True,
        )
        assert result.facts_extracted == 2
        await client.close()

    @respx.mock
    @pytest.mark.asyncio
    async def test_ingest_text(self, client: AsyncMemoClaw):
        respx.post(f"{BASE_URL}/v1/ingest").mock(
            return_value=httpx.Response(200, json={
                "memory_ids": ["m1"],
                "facts_extracted": 1,
                "facts_stored": 1,
                "facts_deduplicated": 0,
                "relations_created": 0, "tokens_used": 30,
            })
        )
        result = await client.ingest(text="some text")
        assert result.facts_stored == 1
        await client.close()

    @pytest.mark.asyncio
    async def test_ingest_empty_raises(self, client: AsyncMemoClaw):
        with pytest.raises(ValueError, match="Either messages or text"):
            await client.ingest()
        await client.close()


class TestAsyncExtract:
    @respx.mock
    @pytest.mark.asyncio
    async def test_extract(self, client: AsyncMemoClaw):
        respx.post(f"{BASE_URL}/v1/memories/extract").mock(
            return_value=httpx.Response(200, json={
                "memory_ids": ["m1"],
                "facts_extracted": 1,
                "facts_stored": 1,
                "facts_deduplicated": 0,
                "tokens_used": 50,
            })
        )
        result = await client.extract(
            [{"role": "user", "content": "I like dark mode"}],
            namespace="ns",
            session_id="s",
            agent_id="a",
        )
        assert result.facts_extracted == 1
        await client.close()

    @pytest.mark.asyncio
    async def test_extract_empty_messages_raises(self, client: AsyncMemoClaw):
        with pytest.raises(ValueError, match="non-empty list"):
            await client.extract([])
        await client.close()


class TestAsyncConsolidate:
    @respx.mock
    @pytest.mark.asyncio
    async def test_consolidate(self, client: AsyncMemoClaw):
        respx.post(f"{BASE_URL}/v1/memories/consolidate").mock(
            return_value=httpx.Response(200, json={
                "clusters_found": 2,
                "memories_merged": 2,
                "memories_created": 1,
                "clusters": [],
            })
        )
        result = await client.consolidate(
            namespace="ns", min_similarity=0.9, mode="merge", dry_run=True
        )
        assert result.memories_merged == 2
        await client.close()


class TestAsyncSuggested:
    @respx.mock
    @pytest.mark.asyncio
    async def test_suggested(self, client: AsyncMemoClaw):
        respx.get(f"{BASE_URL}/v1/suggested").mock(
            return_value=httpx.Response(200, json={
                "suggested": [],
                "categories": {},
                "total": 0,
            })
        )
        result = await client.suggested(limit=5, namespace="ns")
        assert result.total == 0
        await client.close()


class TestAsyncRelations:
    @respx.mock
    @pytest.mark.asyncio
    async def test_create_relation(self, client: AsyncMemoClaw):
        respx.post(f"{BASE_URL}/v1/memories/mem-1/relations").mock(
            return_value=httpx.Response(201, json={
                "id": "rel-1",
                "source_id": "mem-1",
                "target_id": "mem-2",
                "relation_type": "related_to",
                "metadata": {},
                "created_at": "2025-01-01T00:00:00Z",
            })
        )
        rel = await client.create_relation("mem-1", "mem-2", "related_to", metadata={"key": "val"})
        assert rel.id == "rel-1"
        await client.close()

    @respx.mock
    @pytest.mark.asyncio
    async def test_list_relations(self, client: AsyncMemoClaw):
        respx.get(f"{BASE_URL}/v1/memories/mem-1/relations").mock(
            return_value=httpx.Response(200, json={"relations": []})
        )
        rels = await client.list_relations("mem-1")
        assert rels == []
        await client.close()

    @respx.mock
    @pytest.mark.asyncio
    async def test_delete_relation(self, client: AsyncMemoClaw):
        respx.delete(f"{BASE_URL}/v1/memories/mem-1/relations/rel-1").mock(
            return_value=httpx.Response(200, json={"deleted": True})
        )
        result = await client.delete_relation("mem-1", "rel-1")
        assert result.deleted is True
        await client.close()


class TestAsyncMigrate:
    @respx.mock
    @pytest.mark.asyncio
    async def test_migrate(self, client: AsyncMemoClaw):
        respx.post(f"{BASE_URL}/v1/migrate").mock(
            return_value=httpx.Response(200, json={
                "memory_ids": ["m1", "m2"],
                "files_processed": 1,
                "memories_created": 2, "memories_deduplicated": 0, "tokens_used": 50,
            })
        )
        result = await client.migrate(
            [{"filename": "a.md", "content": "hello"}],
            namespace="ns",
            agent_id="a",
            session_id="s",
            auto_tag=True,
        )
        assert result.memories_created == 2
        await client.close()

    @pytest.mark.asyncio
    async def test_migrate_empty_raises(self, client: AsyncMemoClaw):
        with pytest.raises(ValueError, match="must not be empty"):
            await client.migrate([])
        await client.close()

    @respx.mock
    @pytest.mark.asyncio
    async def test_migrate_directory(self, client: AsyncMemoClaw, tmp_path):
        (tmp_path / "a.md").write_text("hello")
        (tmp_path / "b.md").write_text("world")
        respx.post(f"{BASE_URL}/v1/migrate").mock(
            return_value=httpx.Response(200, json={
                "memory_ids": ["m1", "m2"],
                "files_processed": 2,
                "memories_created": 2, "memories_deduplicated": 0, "tokens_used": 50,
            })
        )
        result = await client.migrate_directory(tmp_path, namespace="ns")
        assert result.memories_created == 2
        await client.close()

    @pytest.mark.asyncio
    async def test_migrate_directory_not_found(self, client: AsyncMemoClaw, tmp_path):
        with pytest.raises(ValueError, match="Directory not found"):
            await client.migrate_directory(tmp_path / "nonexistent")
        await client.close()

    @pytest.mark.asyncio
    async def test_migrate_directory_no_files(self, client: AsyncMemoClaw, tmp_path):
        # Empty dir, no .md files
        with pytest.raises(ValueError, match="No files matching"):
            await client.migrate_directory(tmp_path)
        await client.close()


class TestAsyncContext:
    @respx.mock
    @pytest.mark.asyncio
    async def test_assemble_context(self, client: AsyncMemoClaw):
        respx.post(f"{BASE_URL}/v1/context").mock(
            return_value=httpx.Response(200, json={
                "context": "assembled context",
                "memories_used": 3,
                "tokens": 120,
            })
        )
        result = await client.assemble_context(
            "what do I like?",
            namespace="ns",
            max_memories=10,
            max_tokens=500,
            format="text",
            include_metadata=True,
            summarize=True,
        )
        assert result.context == "assembled context"
        await client.close()


class TestAsyncNamespacesAndStats:
    @respx.mock
    @pytest.mark.asyncio
    async def test_list_namespaces(self, client: AsyncMemoClaw):
        respx.get(f"{BASE_URL}/v1/namespaces").mock(
            return_value=httpx.Response(200, json={
                "namespaces": [{"name": "default", "count": 10}],
                "total": 1,
            })
        )
        result = await client.list_namespaces()
        assert len(result.namespaces) == 1
        await client.close()

    @respx.mock
    @pytest.mark.asyncio
    async def test_stats(self, client: AsyncMemoClaw):
        respx.get(f"{BASE_URL}/v1/stats").mock(
            return_value=httpx.Response(200, json={
                "total_memories": 100,
                "pinned_count": 5,
                "never_accessed": 10,
                "total_accesses": 500,
                "avg_importance": 0.6,
            })
        )
        result = await client.stats()
        assert result.total_memories == 100
        await client.close()


class TestAsyncCoreMemories:
    @respx.mock
    @pytest.mark.asyncio
    async def test_core_memories(self, client: AsyncMemoClaw):
        respx.get(f"{BASE_URL}/v1/memories/core").mock(
            return_value=httpx.Response(200, json={
                "memories": [_MEM_JSON],
                "total": 1,
            })
        )
        result = await client.core_memories(limit=5, namespace="ns", agent_id="a")
        assert result.total == 1
        await client.close()


class TestAsyncTextSearch:
    @respx.mock
    @pytest.mark.asyncio
    async def test_text_search(self, client: AsyncMemoClaw):
        respx.post(f"{BASE_URL}/v1/search").mock(
            return_value=httpx.Response(200, json={
                "memories": [_MEM_JSON],
                "total": 1,
                "query": "test",
            })
        )
        result = await client.text_search("test", limit=5, namespace="ns")
        assert result.total == 1
        await client.close()


class TestAsyncExport:
    @respx.mock
    @pytest.mark.asyncio
    async def test_export(self, client: AsyncMemoClaw):
        respx.get(f"{BASE_URL}/v1/export").mock(
            return_value=httpx.Response(200, json={
                "memories": [_MEM_JSON],
                "count": 1,
                "format": "json",
            })
        )
        result = await client.export(format="json", namespace="ns")
        assert result.count == 1
        await client.close()


class TestAsyncHistory:
    @respx.mock
    @pytest.mark.asyncio
    async def test_get_history(self, client: AsyncMemoClaw):
        respx.get(f"{BASE_URL}/v1/memories/mem-1/history").mock(
            return_value=httpx.Response(200, json={
                "history": [
                    {
                        "id": "h-1",
                        "memory_id": "mem-1",
                        "changes": {"action": "created"},
                        "created_at": "2025-01-01T00:00:00Z",
                    }
                ]
            })
        )
        history = await client.get_history("mem-1")
        assert len(history) == 1
        assert history[0].memory_id == "mem-1"
        await client.close()


class TestAsyncUpdateBatch:
    @respx.mock
    @pytest.mark.asyncio
    async def test_update_batch(self, client: AsyncMemoClaw):
        respx.patch(f"{BASE_URL}/v1/memories/batch").mock(
            return_value=httpx.Response(200, json={
                "updated": 2,
                "failed": 0,
                "results": [],
                "tokens_used": 30,
            })
        )
        result = await client.update_batch([
            {"id": "mem-1", "importance": 0.9},
            {"id": "mem-2", "content": "new"},
        ])
        assert result.updated == 2
        await client.close()

    @pytest.mark.asyncio
    async def test_update_batch_empty_raises(self, client: AsyncMemoClaw):
        with pytest.raises(ValueError, match="must not be empty"):
            await client.update_batch([])
        await client.close()

    @pytest.mark.asyncio
    async def test_update_batch_too_large(self, client: AsyncMemoClaw):
        with pytest.raises(ValueError, match="exceeds maximum"):
            await client.update_batch([{"id": f"m{i}"} for i in range(101)])
        await client.close()

    @pytest.mark.asyncio
    async def test_update_batch_missing_id_raises(self, client: AsyncMemoClaw):
        with pytest.raises(ValueError, match="non-empty 'id'"):
            await client.update_batch([{"content": "no id"}])
        await client.close()


class TestAsyncRepr:
    def test_repr(self, client: AsyncMemoClaw):
        r = repr(client)
        assert "AsyncMemoClaw" in r
        assert "signed" in r


class TestAsyncHooks:
    @respx.mock
    @pytest.mark.asyncio
    async def test_hooks(self, client: AsyncMemoClaw):
        calls = {"before": 0, "after": 0, "error": 0}

        def before_hook(method, path, body):
            calls["before"] += 1
            return body

        def after_hook(method, path, result):
            calls["after"] += 1
            return result

        def error_hook(method, path, exc):
            calls["error"] += 1

        client.on_before_request(before_hook)
        client.on_after_response(after_hook)
        client.on_error(error_hook)

        respx.get(f"{BASE_URL}/v1/free-tier/status").mock(
            return_value=httpx.Response(200, json={
                "wallet": "0xabc",
                "free_tier_remaining": 100,
                "free_tier_total": 100,
                "free_tier_used": 0,
            })
        )
        await client.status()
        assert calls["before"] == 1
        assert calls["after"] == 1
        await client.close()


class TestAsyncWalletOnly:
    @pytest.mark.asyncio
    async def test_wallet_only_rejects_paid(self, monkeypatch):
        monkeypatch.delenv("MEMOCLAW_PRIVATE_KEY", raising=False)
        c = AsyncMemoClaw(wallet_address="0x1234567890abcdef1234567890abcdef12345678", base_url=BASE_URL)
        with pytest.raises(ValueError, match="requires a private key"):
            await c.store("test")
        with pytest.raises(ValueError, match="requires a private key"):
            await c.recall("query")
        with pytest.raises(ValueError, match="requires a private key"):
            await c.update("id", content="x")
        with pytest.raises(ValueError, match="requires a private key"):
            await c.ingest(text="x")
        with pytest.raises(ValueError, match="requires a private key"):
            await c.extract([{"role": "user", "content": "x"}])
        with pytest.raises(ValueError, match="requires a private key"):
            await c.consolidate()
        with pytest.raises(ValueError, match="requires a private key"):
            await c.migrate([{"filename": "a.md", "content": "x"}])
        with pytest.raises(ValueError, match="requires a private key"):
            await c.assemble_context("q")
        with pytest.raises(ValueError, match="requires a private key"):
            await c.store_batch([{"content": "x"}])
        with pytest.raises(ValueError, match="requires a private key"):
            await c.update_batch([{"id": "x", "content": "y"}])
        with pytest.raises(ValueError, match="requires a private key"):
            await c.create_relation("a", "b", "related_to")
        await c.close()


class TestAsyncIterMemories:
    @respx.mock
    @pytest.mark.asyncio
    async def test_iter_memories(self, client: AsyncMemoClaw):
        # Page 1
        respx.get(f"{BASE_URL}/v1/memories").mock(
            side_effect=[
                httpx.Response(200, json={
                    "memories": [_MEM_JSON],
                    "total": 2,
                    "limit": 1,
                    "offset": 0,
                }),
                httpx.Response(200, json={
                    "memories": [{**_MEM_JSON, "id": "mem-2"}],
                    "total": 2,
                    "limit": 1,
                    "offset": 1,
                }),
                httpx.Response(200, json={
                    "memories": [],
                    "total": 2,
                    "limit": 1,
                    "offset": 2,
                }),
            ]
        )
        mems = []
        async for mem in client.iter_memories(batch_size=1):
            mems.append(mem)
        assert len(mems) == 2
        await client.close()


class TestAsyncIterExport:
    @respx.mock
    @pytest.mark.asyncio
    async def test_iter_export(self, client: AsyncMemoClaw):
        respx.get(f"{BASE_URL}/v1/memories").mock(
            side_effect=[
                httpx.Response(200, json={
                    "memories": [_MEM_JSON],
                    "total": 1,
                    "limit": 50,
                    "offset": 0,
                }),
                httpx.Response(200, json={
                    "memories": [],
                    "total": 1,
                    "limit": 50,
                    "offset": 1,
                }),
            ]
        )
        mems = []
        async for mem in client.iter_export():
            mems.append(mem)
        assert len(mems) == 1
        await client.close()


class TestAsyncGraphHelpers:
    @respx.mock
    @pytest.mark.asyncio
    async def test_get_memory_graph(self, client: AsyncMemoClaw):
        _rel_mem = {"id": "mem-2", "content": "related", "importance": 0.5, "memory_type": "general", "namespace": "default"}
        respx.get(f"{BASE_URL}/v1/memories/mem-1/relations").mock(
            return_value=httpx.Response(200, json={
                "relations": [{
                    "id": "rel-1",
                    "relation_type": "related_to",
                    "direction": "outgoing",
                    "metadata": {},
                    "memory": _rel_mem, "created_at": "2025-01-01T00:00:00Z",
                }]
            })
        )
        respx.get(f"{BASE_URL}/v1/memories/mem-2/relations").mock(
            return_value=httpx.Response(200, json={"relations": []})
        )
        graph = await client.get_memory_graph("mem-1", depth=2)
        assert "mem-1" in graph
        assert "mem-2" in graph
        await client.close()

    @respx.mock
    @pytest.mark.asyncio
    async def test_find_related(self, client: AsyncMemoClaw):
        _rel_mem2 = {"id": "mem-2", "content": "r2", "importance": 0.5, "memory_type": "general", "namespace": "default"}
        _rel_mem3 = {"id": "mem-3", "content": "r3", "importance": 0.5, "memory_type": "general", "namespace": "default"}
        respx.get(f"{BASE_URL}/v1/memories/mem-1/relations").mock(
            return_value=httpx.Response(200, json={
                "relations": [
                    {
                        "id": "rel-1",
                        "relation_type": "related_to",
                        "direction": "outgoing",
                        "metadata": {},
                        "memory": _rel_mem2, "created_at": "2025-01-01T00:00:00Z",
                    },
                    {
                        "id": "rel-2",
                        "relation_type": "contradicts",
                        "direction": "incoming",
                        "metadata": {},
                        "memory": _rel_mem3, "created_at": "2025-01-01T00:00:00Z",
                    },
                ]
            })
        )
        # Filter by type
        rels = await client.find_related("mem-1", relation_type="related_to")
        assert len(rels) == 1
        assert rels[0].relation_type == "related_to"

        # Filter by direction
        rels2 = await client.find_related("mem-1", direction="incoming")
        assert len(rels2) == 1
        await client.close()


class TestAsyncListAll:
    @respx.mock
    @pytest.mark.asyncio
    async def test_list_all_deprecated(self, client: AsyncMemoClaw):
        respx.get(f"{BASE_URL}/v1/memories").mock(
            return_value=httpx.Response(200, json={
                "memories": [_MEM_JSON],
                "total": 1,
                "limit": 50,
                "offset": 0,
            })
        )
        import warnings
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            mems = []
            async for mem in client.list_all():
                mems.append(mem)
            assert len(mems) == 1
            assert any("deprecated" in str(warning.message).lower() for warning in w)
        await client.close()
