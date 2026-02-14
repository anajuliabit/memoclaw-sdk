"""Real-world example: Async AI Assistant with persistent memory.

This example demonstrates how to build an AI assistant using the async client
for better performance in async contexts like FastAPI or asyncio applications.

Run with: python examples/python/async_example.py
"""

import asyncio
from datetime import datetime, timedelta

from memoclaw import AsyncMemoClaw
from memoclaw.builders import (
    AsyncRecallQuery,
    AsyncMemoryFilter,
    AsyncStoreBuilder,
    BatchStore,
)
from memoclaw.types import MemoryType


async def main():
    print("=== Async AI Assistant Memory Demo ===\n")

    # Initialize async client
    client = AsyncMemoClaw()

    # 1. Store a memory using the async store builder
    print("1. Using AsyncStoreBuilder...")
    result = await (
        AsyncStoreBuilder(client)
        .content("User prefers dark mode in their IDE")
        .importance(0.9)
        .tags(["preference", "ui", "ide"])
        .namespace("user-preferences")
        .memory_type(MemoryType.PREFERENCE)
        .execute()
    )
    print(f"   Stored memory: {result.id}\n")

    # 2. Batch store using async
    print("2. Batch storing memories...")
    batch = BatchStore(client)
    for i in range(5):
        batch.add(
            f"Memory {i}: Important fact about user preferences",
            importance=0.7,
            namespace="batch-test",
        )
    batch_result = await batch.execute()  # BatchStore.execute() is sync but works with async client
    print(f"   Stored {batch_result['count']} memories\n")

    # 3. Async recall query with filters
    print("3. Using AsyncRecallQuery...")
    recall_results = await (
        AsyncRecallQuery(client)
        .with_query("user preferences for IDE")
        .with_limit(5)
        .with_min_similarity(0.5)
        .with_namespace("user-preferences")
        .include_relations()
        .execute()
    )
    print(f"   Found {len(recall_results.memories)} memories:")
    for mem in recall_results.memories:
        print(f"   - [{mem.similarity:.2f}] {mem.content}\n")

    # 4. Async memory filter with iteration
    print("4. Using AsyncMemoryFilter...")
    memory_count = await (
        AsyncMemoryFilter(client)
        .with_namespace("user-preferences")
        .count()
    )
    print(f"   Total user-preference memories: {memory_count}")

    all_memories = await (
        AsyncMemoryFilter(client)
        .with_namespace("user-preferences")
        .list_all()
    )
    print(f"   Retrieved {len(all_memories)} memories\n")

    # 5. Async iteration over memories
    print("5. Async iteration with iter_memories...")
    async for memory in client.iter_memories(namespace="user-preferences", batch_size=10):
        print(f"   - {memory.content[:50]}...")
    print()

    # 6. Store with expiration
    print("6. Storing memory with expiration...")
    expires_at = (datetime.utcnow() + timedelta(days=7)).isoformat() + "Z"
    temp_memory = await client.store(
        "Temporary session context",
        namespace="sessions",
        expires_at=expires_at,
        importance=0.3,
    )
    print(f"   Created temporary memory: {temp_memory.id} (expires at {expires_at})\n")

    # 7. Check status
    print("7. Checking free tier status...")
    status = await client.status()
    print(f"   Remaining: {status.free_tier_remaining}/{status.free_tier_total}\n")

    # 8. Using hooks in async context
    print("8. Demonstrating hooks...")

    async def log_request(method: str, path: str, body: dict | None):
        print(f"   → {method} {path}")

    async def log_response(method: str, path: str, data):
        print(f"   ← {method} {path} -> OK")

    client.on_before_request(log_request)
    client.on_after_response(log_response)

    # This will trigger the hooks
    await client.status()

    print("\n=== Demo Complete ===")

    # Cleanup
    await client.close()


if __name__ == "__main__":
    asyncio.run(main())
