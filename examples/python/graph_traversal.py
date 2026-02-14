"""Example: Memory Graph Traversal

This example demonstrates how to traverse the memory graph
to find related memories and understand connections.

Run with: python examples/python/graph_traversal.py
"""

from memoclaw import MemoClaw, AsyncMemoClaw
from memoclaw.builders import RelationBuilder, MemoryFilter


def main():
    print("=== Memory Graph Traversal Example (Sync) ===\n")

    # Initialize client with your private key
    client = MemoClaw()

    # First, let's store some memories with relations
    print("1. Storing memories and creating relations...\n")

    # Store source memories
    mem1 = client.store(
        content="User prefers dark mode for IDE",
        importance=0.8,
        memory_type="preference",
        namespace="user-settings",
    )

    mem2 = client.store(
        content="User prefers VS Code over IntelliJ",
        importance=0.7,
        memory_type="preference",
        namespace="user-settings",
    )

    mem3 = client.store(
        content="User is a Python developer",
        importance=0.9,
        memory_type="observation",
        namespace="user-settings",
    )

    mem4 = client.store(
        content="User works on machine learning projects",
        importance=0.8,
        memory_type="observation",
        namespace="user-settings",
    )

    print(f"Created memories: {mem1.id}, {mem2.id}, {mem3.id}, {mem4.id}")

    # Create relations between memories
    print("\n2. Creating relations between memories...\n")

    RelationBuilder(client, mem1.id).relate_to(
        mem2.id, "supports"
    ).relate_to(mem3.id, "related_to").create_all()

    RelationBuilder(client, mem3.id).relate_to(
        mem4.id, "related_to"
    ).create_all()

    print("Relations created successfully")

    # Find directly related memories
    print("\n3. Finding directly related memories...\n")

    related = client.find_related(mem1.id)
    print(f"Found {len(related)} direct relations for '{mem1.id}':")
    for rel in related:
        print(f"  - {rel.relation_type}: {rel.memory.content}")

    # Traverse the graph to depth 2
    print("\n4. Traversing graph to depth 2...\n")

    graph = client.get_memory_graph(mem1.id, depth=2)
    print(f"Visited {len(graph)} nodes in the graph:")

    for memory_id, relations in graph.items():
        print(f"\n  Memory: {memory_id}")
        print(f"  Relations: {len(relations)}")
        for rel in relations:
            print(f"    - [{rel.relation_type}] {rel.memory.content}")

    # Filter and find specific relation types
    print("\n5. Finding specific relation types...\n")

    supporting = client.find_related(mem1.id, relation_type="supports")
    print(f"Found {len(supporting)} 'supports' relations:")
    for rel in supporting:
        print(f"  - {rel.memory.content}")

    # Use MemoryFilter with namespace
    print("\n6. Using MemoryFilter with namespace...\n")

    memories = MemoryFilter(client).with_namespace("user-settings").list_all()

    print(f"Found {len(memories)} memories in 'user-settings' namespace:")
    for mem in memories:
        print(f"  - {mem.content[:50]}...")

    print("\n=== Example Complete ===")


async def async_main():
    """Async version of the example."""
    print("=== Memory Graph Traversal Example (Async) ===\n")

    async with AsyncMemoClaw() as client:
        # Store memories
        mem1 = await client.store(
            content="User prefers dark mode",
            importance=0.8,
            namespace="test",
        )
        mem2 = await client.store(
            content="User prefers Python",
            importance=0.9,
            namespace="test",
        )

        # Create relation
        await client.create_relation(mem1.id, mem2.id, "related_to")

        # Find related
        related = await client.find_related(mem1.id)
        print(f"Found {len(related)} related memories")

        # Get graph
        graph = await client.get_memory_graph(mem1.id, depth=1)
        print(f"Graph has {len(graph)} nodes")


if __name__ == "__main__":
    main()
    # Uncomment to run async version:
    # import asyncio
    # asyncio.run(async_main())
