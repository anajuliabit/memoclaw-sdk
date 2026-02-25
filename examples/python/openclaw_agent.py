"""OpenClaw agent integration with MemoClaw.

Shows how an OpenClaw agent can use MemoClaw as its persistent memory layer,
replacing flat markdown files with semantic search and automatic deduplication.

Usage:
    pip install memoclaw
    export MEMOCLAW_PRIVATE_KEY=0x...
    python openclaw_agent.py
"""

from __future__ import annotations

from memoclaw import MemoClaw


def main() -> None:
    client = MemoClaw()

    # ── 1. Migrate existing AGENTS.md memory files ────────────────────
    # OpenClaw agents store daily notes in memory/YYYY-MM-DD.md.
    # Migrate them to MemoClaw for semantic search instead of flat-file reads.
    try:
        result = client.migrate_directory(
            "memory/",
            pattern="*.md",
            namespace="daily-notes",
            auto_tag=True,
        )
        print(f"Migrated {result.imported} memories from daily notes")
    except ValueError:
        print("No memory files to migrate (first run?)")

    # ── 2. Store memories from agent interactions ─────────────────────
    # During conversations, store important facts.
    stored = client.store(
        "User prefers concise responses and dislikes filler phrases like 'Great question!'",
        importance=0.9,
        tags=["preferences", "communication-style"],
        namespace="user-profile",
        pinned=True,  # Core preferences should never decay
    )
    print(f"Stored: {stored.id}")

    # ── 3. Recall context before responding ───────────────────────────
    # Before generating a response, recall relevant memories.
    memories = client.recall(
        "What does the user prefer about communication style?",
        namespace="user-profile",
        limit=5,
    )
    for m in memories.memories:
        print(f"  [{m.similarity:.2f}] {m.content[:80]}")

    # ── 4. Assemble context for LLM prompts ──────────────────────────
    # Build a context block to inject into system prompts.
    ctx = client.assemble_context(
        "user preferences and recent conversations",
        max_memories=10,
        max_tokens=500,
        format="markdown",
    )
    print(f"\nContext block ({ctx.token_estimate} tokens):\n{ctx.context[:200]}...")

    # ── 5. Ingest conversations automatically ─────────────────────────
    # After each conversation turn, extract and store facts.
    client.ingest(
        messages=[
            {"role": "user", "content": "I'm working on a Rust project called memoclaw-rs"},
            {"role": "assistant", "content": "I'll remember that. What aspect are you working on?"},
            {"role": "user", "content": "The FFI bindings for Python"},
        ],
        namespace="conversations",
        agent_id="openclaw-main",
    )

    # ── 6. Consolidate during heartbeats ──────────────────────────────
    # Run periodically (e.g., in HEARTBEAT.md checks) to merge duplicates.
    result = client.consolidate(namespace="conversations", dry_run=True)
    print(f"\nConsolidation preview: {result.merged_count} memories would be merged")

    # ── 7. Multi-agent namespace isolation ────────────────────────────
    # Each OpenClaw agent/subagent can use its own namespace.
    client.store(
        "CI pipeline for memoclaw-sdk uses GitHub Actions with Python 3.10-3.13 matrix",
        namespace="agent:backend",
        agent_id="backend-subagent",
        tags=["ci", "infrastructure"],
    )

    # ── 8. Core memories for quick access ─────────────────────────────
    # Get the most important memories without semantic search (free tier).
    core = client.core_memories(namespace="user-profile", limit=5)
    print(f"\nCore memories: {len(core.memories)} found")
    for m in core.memories:
        print(f"  [importance={m.importance}] {m.content[:60]}")

    client.close()
    print("\nDone!")


if __name__ == "__main__":
    main()
