"""Real-world example: AI Assistant with persistent memory.

This example demonstrates how to build an AI assistant that:
- Stores conversation history
- Recalls relevant past context
- Manages user preferences
- Handles memory consolidation

Run with: python examples/python/ai_assistant_example.py
"""

from memoclaw import MemoClaw, AsyncMemoClaw
from memoclaw.builders import RecallQuery, MemoryFilter, BatchStore

# Initialize client (reads MEMOCLAW_PRIVATE_KEY from env)
client = MemoClaw()

# Simulated conversation messages
conversation = [
    {"role": "user", "content": "I prefer dark mode in my IDE"},
    {"role": "assistant", "content": "Got it! I'll remember you prefer dark mode."},
    {"role": "user", "content": "Also, I like Python more than JavaScript"},
    {"role": "assistant", "content": "Noted! Your preference for Python is saved."},
    {"role": "user", "content": "Can you help me with a Django project?"},
    {"role": "assistant", "content": "Absolutely! I have experience with Django."},
]


def main():
    print("=== AI Assistant Memory Demo ===\n")

    # 1. Ingest conversation and auto-extract memories
    print("1. Ingesting conversation...")
    ingest = client.ingest(
        messages=conversation,
        namespace="ai-assistant",
        session_id="session-demo-001",
        auto_relate=True,
    )
    print(f"   Extracted {ingest.facts_extracted} facts, stored {ingest.facts_stored}")
    print(f"   Created {ingest.relations_created} relations\n")

    # 2. Store user preferences explicitly with high importance
    print("2. Storing explicit preferences...")
    pref1 = client.store(
        "User prefers dark mode in IDE",
        importance=0.95,
        memory_type="preference",
        namespace="user-prefs",
        tags=["preference", "ide", "ui"],
    )
    pref2 = client.store(
        "User prefers Python over JavaScript",
        importance=0.9,
        memory_type="preference",
        namespace="user-prefs",
        tags=["preference", "language"],
    )
    print(f"   Stored: {pref1.id}, {pref2.id}\n")

    # 3. Use builder pattern for complex recall
    print("3. Using RecallQuery builder...")
    recall_results = (
        RecallQuery(client)
        .with_query("What are my IDE and language preferences?")
        .with_limit(5)
        .with_namespace("user-prefs")
        .with_min_similarity(0.6)
        .include_relations()
        .execute()
    )

    print("   Found preferences:")
    for mem in recall_results.memories:
        print(f"   - [{mem.similarity:.2f}] {mem.content}")
    print()

    # 4. Batch store project memories
    print("4. Batch storing project memories...")
    project_memories = [
        {"content": "Django REST Framework project", "namespace": "projects", "memory_type": "project"},
        {"content": "PostgreSQL database", "namespace": "projects", "memory_type": "project"},
        {"content": "Celery for async tasks", "namespace": "projects", "memory_type": "project"},
        {"content": "Redis for caching", "namespace": "projects", "memory_type": "project"},
        {"content": "Docker for containerization", "namespace": "projects", "memory_type": "project"},
    ]

    store = BatchStore(client)
    store.add_many(project_memories)
    batch_result = store.execute()
    print(f"   Stored {batch_result['count']} project memories\n")

    # 5. Use MemoryFilter for iteration
    print("5. Using MemoryFilter to iterate...")
    all_prefs = (
        MemoryFilter(client)
        .with_namespace("user-prefs")
        .list_all()
    )
    print(f"   Found {len(all_prefs)} user preferences")

    # 6. Graph traversal
    print("\n6. Memory graph traversal...")
    graph = client.get_memory_graph(pref1.id, depth=2)
    print(f"   Graph from '{pref1.id}':")
    for mid, relations in graph.items():
        print(f"   - {mid}: {len(relations)} relations")

    # 7. Suggested memories (decaying/stale)
    print("\n7. Getting suggested memories...")
    suggested = client.suggested(limit=5, category="stale")
    print(f"   Found {suggested.total} stale memories")

    # 8. Check free tier status
    print("\n8. Free tier status:")
    status = client.status()
    print(f"   Remaining: {status.free_tier_remaining}/{status.free_tier_total}")

    print("\n=== Demo Complete ===")
    client.close()


if __name__ == "__main__":
    main()
