"""Pagination iterators and memory graph traversal."""

import asyncio
from memoclaw import MemoClaw, AsyncMemoClaw


def sync_example():
    """Iterate over ALL memories without managing pagination manually."""
    client = MemoClaw()

    # list_all() handles pagination automatically
    count = 0
    for memory in client.list_all(batch_size=25, namespace="default"):
        print(f"  {memory.id}: {memory.content[:60]}...")
        count += 1
    print(f"Iterated over {count} memories")

    # Graph traversal — find related memories up to 2 hops away
    graph = client.get_memory_graph("mem-123", depth=2)
    for mid, relations in graph.items():
        print(f"  {mid}: {len(relations)} relations")
        for rel in relations:
            print(f"    → {rel.relation_type} → {rel.memory.content[:40]}...")

    # Filter relations by type
    contradictions = client.find_related("mem-123", relation_type="contradicts")
    print(f"Found {len(contradictions)} contradictions")

    client.close()


async def async_example():
    """Same features work with the async client."""
    async with AsyncMemoClaw() as client:
        # Async iteration
        async for memory in client.list_all(namespace="default"):
            print(f"  {memory.id}: {memory.content[:60]}...")

        # Async graph traversal
        graph = await client.get_memory_graph("mem-123", depth=2)
        for mid, rels in graph.items():
            print(f"  {mid}: {len(rels)} relations")


if __name__ == "__main__":
    sync_example()
    # asyncio.run(async_example())
