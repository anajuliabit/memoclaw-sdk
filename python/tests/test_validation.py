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


class TestConstructorValidation:
    def test_empty_wallet_address_raises(self):
        with pytest.raises(ValueError, match="non-empty"):
            MemoClaw(wallet_address="")

    def test_whitespace_wallet_address_raises(self):
        with pytest.raises(ValueError, match="non-empty"):
            MemoClaw(wallet_address="   ")

    def test_async_empty_wallet_address_raises(self):
        with pytest.raises(ValueError, match="non-empty"):
            AsyncMemoClaw(wallet_address="")


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

    def test_store_batch_empty_content_dict(self, client: MemoClaw):
        with pytest.raises(ValueError, match="content must be a non-empty string"):
            client.store_batch([{"content": ""}])

    def test_store_batch_whitespace_content_dict(self, client: MemoClaw):
        with pytest.raises(ValueError, match="content must be a non-empty string"):
            client.store_batch([{"content": "   "}])

    def test_store_batch_missing_content_dict(self, client: MemoClaw):
        with pytest.raises(ValueError, match="content must be a non-empty string"):
            client.store_batch([{}])

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


    def test_update_empty_memory_id(self, client: MemoClaw):
        with pytest.raises(ValueError, match="memory_id"):
            client.update("", content="new content")

    def test_update_whitespace_memory_id(self, client: MemoClaw):
        with pytest.raises(ValueError, match="memory_id"):
            client.update("   ", content="new content")

    def test_ingest_no_messages_or_text(self, client: MemoClaw):
        with pytest.raises(ValueError, match="Either messages or text"):
            client.ingest()

    def test_ingest_empty_text(self, client: MemoClaw):
        with pytest.raises(ValueError, match="Either messages or text"):
            client.ingest(text="")

    def test_ingest_whitespace_text(self, client: MemoClaw):
        with pytest.raises(ValueError, match="Either messages or text"):
            client.ingest(text="   ")

    def test_extract_empty_messages(self, client: MemoClaw):
        with pytest.raises(ValueError, match="messages must be a non-empty"):
            client.extract([])

    def test_get_history_empty_id(self, client: MemoClaw):
        with pytest.raises(ValueError, match="memory_id"):
            client.get_history("")

    def test_assemble_context_empty_query(self, client: MemoClaw):
        with pytest.raises(ValueError, match="query"):
            client.assemble_context("")

    def test_text_search_empty_query(self, client: MemoClaw):
        with pytest.raises(ValueError, match="query"):
            client.text_search("")


class TestImportanceValidation:
    """Tests for importance range validation (0.0 to 1.0)."""

    def test_store_importance_too_high(self, client: MemoClaw):
        with pytest.raises(ValueError, match="importance must be between 0.0 and 1.0"):
            client.store("content", importance=1.5)

    def test_store_importance_too_low(self, client: MemoClaw):
        with pytest.raises(ValueError, match="importance must be between 0.0 and 1.0"):
            client.store("content", importance=-0.1)

    def test_update_importance_too_high(self, client: MemoClaw):
        with pytest.raises(ValueError, match="importance must be between 0.0 and 1.0"):
            client.update("mem-1", importance=2.0)

    def test_update_importance_too_low(self, client: MemoClaw):
        with pytest.raises(ValueError, match="importance must be between 0.0 and 1.0"):
            client.update("mem-1", importance=-1.0)

    def test_store_batch_importance_too_high(self, client: MemoClaw):
        with pytest.raises(ValueError, match=r"memories\[0\] importance must be between"):
            client.store_batch([{"content": "test", "importance": 1.5}])

    def test_store_batch_importance_too_low(self, client: MemoClaw):
        with pytest.raises(ValueError, match=r"memories\[1\] importance must be between"):
            client.store_batch([
                {"content": "ok", "importance": 0.5},
                {"content": "bad", "importance": -0.1},
            ])


class TestContentLengthValidation:
    """Tests for content length validation (8192 char limit)."""

    def test_store_content_too_long(self, client: MemoClaw):
        with pytest.raises(ValueError, match="8192 character limit"):
            client.store("x" * 8193)

    def test_store_content_at_limit(self, client: MemoClaw):
        # Should NOT raise ValueError — exactly 8192 is allowed
        try:
            client.store("x" * 8192)
        except ValueError:
            pytest.fail("Should not raise ValueError for content at exactly 8192 chars")
        except Exception:
            pass  # Expected — HTTP error since no mock

    def test_update_content_too_long(self, client: MemoClaw):
        with pytest.raises(ValueError, match="8192 character limit"):
            client.update("mem-1", content="x" * 8193)

    def test_store_batch_content_too_long(self, client: MemoClaw):
        with pytest.raises(ValueError, match=r"memories\[0\].*8192 character limit"):
            client.store_batch([{"content": "x" * 8193}])


class TestAsyncImportanceValidation:
    """Async tests for importance validation."""

    @pytest.mark.asyncio
    async def test_store_importance_too_high(self, async_client: AsyncMemoClaw):
        with pytest.raises(ValueError, match="importance must be between 0.0 and 1.0"):
            await async_client.store("content", importance=1.5)

    @pytest.mark.asyncio
    async def test_update_importance_too_high(self, async_client: AsyncMemoClaw):
        with pytest.raises(ValueError, match="importance must be between 0.0 and 1.0"):
            await async_client.update("mem-1", importance=2.0)

    @pytest.mark.asyncio
    async def test_store_batch_importance_too_high(self, async_client: AsyncMemoClaw):
        with pytest.raises(ValueError, match=r"memories\[0\] importance must be between"):
            await async_client.store_batch([{"content": "test", "importance": 1.5}])


class TestAsyncContentLengthValidation:
    """Async tests for content length validation."""

    @pytest.mark.asyncio
    async def test_store_content_too_long(self, async_client: AsyncMemoClaw):
        with pytest.raises(ValueError, match="8192 character limit"):
            await async_client.store("x" * 8193)

    @pytest.mark.asyncio
    async def test_update_content_too_long(self, async_client: AsyncMemoClaw):
        with pytest.raises(ValueError, match="8192 character limit"):
            await async_client.update("mem-1", content="x" * 8193)

    @pytest.mark.asyncio
    async def test_store_batch_content_too_long(self, async_client: AsyncMemoClaw):
        with pytest.raises(ValueError, match=r"memories\[0\].*8192 character limit"):
            await async_client.store_batch([{"content": "x" * 8193}])


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
    async def test_store_batch_empty_content_dict(self, async_client: AsyncMemoClaw):
        with pytest.raises(ValueError, match="content must be a non-empty string"):
            await async_client.store_batch([{"content": ""}])

    @pytest.mark.asyncio
    async def test_store_batch_whitespace_content_dict(self, async_client: AsyncMemoClaw):
        with pytest.raises(ValueError, match="content must be a non-empty string"):
            await async_client.store_batch([{"content": "   "}])

    @pytest.mark.asyncio
    async def test_store_batch_missing_content_dict(self, async_client: AsyncMemoClaw):
        with pytest.raises(ValueError, match="content must be a non-empty string"):
            await async_client.store_batch([{}])

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

    @pytest.mark.asyncio
    async def test_update_empty_memory_id(self, async_client: AsyncMemoClaw):
        with pytest.raises(ValueError, match="memory_id"):
            await async_client.update("", content="new content")

    @pytest.mark.asyncio
    async def test_update_whitespace_memory_id(self, async_client: AsyncMemoClaw):
        with pytest.raises(ValueError, match="memory_id"):
            await async_client.update("   ", content="new content")

    @pytest.mark.asyncio
    async def test_ingest_no_messages_or_text(self, async_client: AsyncMemoClaw):
        with pytest.raises(ValueError, match="Either messages or text"):
            await async_client.ingest()

    @pytest.mark.asyncio
    async def test_ingest_empty_text(self, async_client: AsyncMemoClaw):
        with pytest.raises(ValueError, match="Either messages or text"):
            await async_client.ingest(text="")

    @pytest.mark.asyncio
    async def test_extract_empty_messages(self, async_client: AsyncMemoClaw):
        with pytest.raises(ValueError, match="messages must be a non-empty"):
            await async_client.extract([])

    @pytest.mark.asyncio
    async def test_get_history_empty_id(self, async_client: AsyncMemoClaw):
        with pytest.raises(ValueError, match="memory_id"):
            await async_client.get_history("")

    @pytest.mark.asyncio
    async def test_assemble_context_empty_query(self, async_client: AsyncMemoClaw):
        with pytest.raises(ValueError, match="query"):
            await async_client.assemble_context("")

    @pytest.mark.asyncio
    async def test_text_search_empty_query(self, async_client: AsyncMemoClaw):
        with pytest.raises(ValueError, match="query"):
            await async_client.text_search("")


class TestContentLengthValidation:
    """Tests for the 8192 character content length limit."""

    def test_store_content_too_long(self, client: MemoClaw):
        with pytest.raises(ValueError, match="8192 character limit"):
            client.store("x" * 8193)

    def test_store_content_at_limit(self, client: MemoClaw):
        # Should NOT raise (exactly at limit)
        # We can't actually store, so just verify validation passes
        # by checking a different error is raised (network/API)
        content = "x" * 8192
        try:
            client.store(content)
        except ValueError as e:
            assert "8192" not in str(e), "Should not reject content exactly at 8192 chars"
        except Exception:
            pass  # Network or other errors are fine

    def test_store_batch_content_too_long(self, client: MemoClaw):
        with pytest.raises(ValueError, match="8192 character limit"):
            client.store_batch([{"content": "x" * 8193}])

    def test_update_content_too_long(self, client: MemoClaw):
        with pytest.raises(ValueError, match="8192 character limit"):
            client.update("mem-1", content="x" * 8193)

    def test_update_without_content_no_length_check(self, client: MemoClaw):
        # Should NOT raise content length error when content is not provided
        try:
            client.update("mem-1", importance=0.5)
        except ValueError as e:
            assert "8192" not in str(e)
        except Exception:
            pass

    @pytest.mark.asyncio
    async def test_async_store_content_too_long(self, async_client: AsyncMemoClaw):
        with pytest.raises(ValueError, match="8192 character limit"):
            await async_client.store("x" * 8193)

    @pytest.mark.asyncio
    async def test_async_store_batch_content_too_long(self, async_client: AsyncMemoClaw):
        with pytest.raises(ValueError, match="8192 character limit"):
            await async_client.store_batch([{"content": "x" * 8193}])

    @pytest.mark.asyncio
    async def test_async_update_content_too_long(self, async_client: AsyncMemoClaw):
        with pytest.raises(ValueError, match="8192 character limit"):
            await async_client.update("mem-1", content="x" * 8193)


class TestImportanceValidation:
    """Tests for importance range validation (0.0 to 1.0)."""

    def test_store_importance_too_high(self, client: MemoClaw):
        with pytest.raises(ValueError, match="importance must be between"):
            client.store("test", importance=1.5)

    def test_store_importance_negative(self, client: MemoClaw):
        with pytest.raises(ValueError, match="importance must be between"):
            client.store("test", importance=-0.1)

    def test_store_importance_at_bounds(self, client: MemoClaw):
        # 0.0 and 1.0 should be valid
        try:
            client.store("test", importance=0.0)
        except ValueError as e:
            assert "importance" not in str(e)
        except Exception:
            pass
        try:
            client.store("test", importance=1.0)
        except ValueError as e:
            assert "importance" not in str(e)
        except Exception:
            pass

    @pytest.mark.asyncio
    async def test_async_store_importance_too_high(self, async_client: AsyncMemoClaw):
        with pytest.raises(ValueError, match="importance must be between"):
            await async_client.store("test", importance=1.5)

    @pytest.mark.asyncio
    async def test_async_store_importance_negative(self, async_client: AsyncMemoClaw):
        with pytest.raises(ValueError, match="importance must be between"):
            await async_client.store("test", importance=-0.1)

    def test_update_importance_too_high(self, client: MemoClaw):
        with pytest.raises(ValueError, match="importance must be between"):
            client.update("mem-1", importance=2.0)

    @pytest.mark.asyncio
    async def test_async_update_importance_too_high(self, async_client: AsyncMemoClaw):
        with pytest.raises(ValueError, match="importance must be between"):
            await async_client.update("mem-1", importance=2.0)


class TestDeleteBatchValidation:
    def test_empty_list_raises(self, client: MemoClaw):
        with pytest.raises(ValueError, match="memory_ids list must not be empty"):
            client.delete_batch([])


class TestAsyncDeleteBatchValidation:
    @pytest.mark.asyncio
    async def test_empty_list_raises(self, async_client: AsyncMemoClaw):
        with pytest.raises(ValueError, match="memory_ids list must not be empty"):
            await async_client.delete_batch([])
