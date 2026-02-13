"""Ingest a conversation and auto-extract memories."""

from memoclaw import MemoClaw

with MemoClaw() as client:
    # Ingest a conversation — MemoClaw auto-extracts facts
    result = client.ingest(
        messages=[
            {"role": "user", "content": "I'm working on a Rust project for blockchain indexing"},
            {"role": "assistant", "content": "That sounds interesting! What chain?"},
            {"role": "user", "content": "Ethereum mainnet. I'm using Alloy for RPC calls."},
            {"role": "assistant", "content": "Great choice. Are you indexing events or traces?"},
            {"role": "user", "content": "Events for now, but I want to add trace support later."},
        ],
        namespace="project-context",
        session_id="chat-2025-06-01",
        auto_relate=True,
    )

    print(f"Extracted {result.facts_extracted} facts, stored {result.facts_stored}")
    print(f"Created {result.relations_created} relations")
    print(f"Memory IDs: {result.memory_ids}")

    # Now recall project context later
    recall = client.recall(
        "What tech stack is the user using?",
        namespace="project-context",
    )
    for mem in recall.memories:
        print(f"  → {mem.content}")
