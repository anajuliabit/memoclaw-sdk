"""Tests for client-side input validation."""

from __future__ import annotations

import pytest

from memoclaw import MemoClaw, AsyncMemoClaw

TEST_PRIVATE_KEY = "0x4c0883a69102937d6231471b5dbb6204fe512961708279f15a8f7e20b4e3b1fb"


@pytest.fixture
def client():
    c = MemoClaw(private_key=TEST_PRIVATE_KEY)
    yield c
    c.close()


@pytest.fixture
def async_client():
    return AsyncMemoClaw(private_key=TEST_PRIVATE_KEY)


class TestSyncValidation:
    def test_store_empty_content(self, client: MemoClaw):
        with pytest.raises(ValueError, match="content"):
            client.store("")

    def test_store_whitespace_content(self, client: MemoClaw):
        with pytest.raises(ValueError, match="content"):
            client.store("   ")

    def test_recall_empty_query(self, client: MemoClaw):
        with pytest.raises(ValueError, match="query"):
            client.recall("")

    def test_get_empty_id(self, client: MemoClaw):
        with pytest.raises(ValueError, match="memory_id"):
            client.get("")

    def test_store_batch_empty(self, client: MemoClaw):
        with pytest.raises(ValueError, match="must not be empty"):
            client.store_batch([])

    def test_store_batch_exceeds_max(self, client: MemoClaw):
        memories = [{"content": f"mem {i}"} for i in range(101)]
        with pytest.raises(ValueError, match="exceeds maximum"):
            client.store_batch(memories)


    def test_delete_empty_id(self, client: MemoClaw):
        with pytest.raises(ValueError, match="memory_id"):
            client.delete("")

    def test_delete_whitespace_id(self, client: MemoClaw):
        with pytest.raises(ValueError, match="memory_id"):
            client.delete("   ")

    def test_create_relation_empty_memory_id(self, client: MemoClaw):
        with pytest.raises(ValueError, match="memory_id"):
            client.create_relation("", "target-id", "related_to")

    def test_create_relation_empty_target_id(self, client: MemoClaw):
        with pytest.raises(ValueError, match="target_id"):
            client.create_relation("mem-id", "", "related_to")

    def test_list_relations_empty_id(self, client: MemoClaw):
        with pytest.raises(ValueError, match="memory_id"):
            client.list_relations("")

    def test_delete_relation_empty_memory_id(self, client: MemoClaw):
        with pytest.raises(ValueError, match="memory_id"):
            client.delete_relation("", "rel-id")

    def test_delete_relation_empty_relation_id(self, client: MemoClaw):
        with pytest.raises(ValueError, match="relation_id"):
            client.delete_relation("mem-id", "")


class TestAsyncValidation:
    @pytest.mark.asyncio
    async def test_store_empty_content(self, async_client: AsyncMemoClaw):
        with pytest.raises(ValueError, match="content"):
            await async_client.store("")

    @pytest.mark.asyncio
    async def test_recall_empty_query(self, async_client: AsyncMemoClaw):
        with pytest.raises(ValueError, match="query"):
            await async_client.recall("")

    @pytest.mark.asyncio
    async def test_get_empty_id(self, async_client: AsyncMemoClaw):
        with pytest.raises(ValueError, match="memory_id"):
            await async_client.get("")

    @pytest.mark.asyncio
    async def test_store_batch_empty(self, async_client: AsyncMemoClaw):
        with pytest.raises(ValueError, match="must not be empty"):
            await async_client.store_batch([])

    @pytest.mark.asyncio
    async def test_store_batch_exceeds_max(self, async_client: AsyncMemoClaw):
        memories = [{"content": f"mem {i}"} for i in range(101)]
        with pytest.raises(ValueError, match="exceeds maximum"):
            await async_client.store_batch(memories)

    @pytest.mark.asyncio
    async def test_delete_empty_id(self, async_client: AsyncMemoClaw):
        with pytest.raises(ValueError, match="memory_id"):
            await async_client.delete("")

    @pytest.mark.asyncio
    async def test_create_relation_empty_memory_id(self, async_client: AsyncMemoClaw):
        with pytest.raises(ValueError, match="memory_id"):
            await async_client.create_relation("", "target-id", "related_to")

    @pytest.mark.asyncio
    async def test_create_relation_empty_target_id(self, async_client: AsyncMemoClaw):
        with pytest.raises(ValueError, match="target_id"):
            await async_client.create_relation("mem-id", "", "related_to")

    @pytest.mark.asyncio
    async def test_list_relations_empty_id(self, async_client: AsyncMemoClaw):
        with pytest.raises(ValueError, match="memory_id"):
            await async_client.list_relations("")

    @pytest.mark.asyncio
    async def test_delete_relation_empty_ids(self, async_client: AsyncMemoClaw):
        with pytest.raises(ValueError, match="memory_id"):
            await async_client.delete_relation("", "rel-id")
        with pytest.raises(ValueError, match="relation_id"):
            await async_client.delete_relation("mem-id", "")
