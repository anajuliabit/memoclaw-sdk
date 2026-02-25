/**
 * OpenClaw agent integration with MemoClaw.
 *
 * Shows how an OpenClaw agent can use MemoClaw as its persistent memory layer,
 * replacing flat markdown files with semantic search and automatic deduplication.
 *
 * Usage:
 *   npm install @memoclaw/sdk
 *   export MEMOCLAW_WALLET=0x...
 *   npx tsx openclaw_agent.ts
 */

import { MemoClawClient } from '@memoclaw/sdk';

async function main() {
  const client = new MemoClawClient();

  // ── 1. Migrate existing AGENTS.md memory files ────────────────────
  // OpenClaw agents store daily notes in memory/YYYY-MM-DD.md.
  // Migrate them to MemoClaw for semantic search instead of flat-file reads.
  try {
    const migrated = await client.migrateDirectory('./memory', {
      namespace: 'daily-notes',
      auto_tag: true,
    });
    console.log(`Migrated ${migrated.imported} memories from daily notes`);
  } catch {
    console.log('No memory files to migrate (first run?)');
  }

  // ── 2. Store memories from agent interactions ─────────────────────
  // During conversations, store important facts.
  const stored = await client.store({
    content: "User prefers concise responses and dislikes filler phrases like 'Great question!'",
    importance: 0.9,
    metadata: { tags: ['preferences', 'communication-style'] },
    namespace: 'user-profile',
    pinned: true, // Core preferences should never decay
  });
  console.log(`Stored: ${stored.id}`);

  // ── 3. Recall context before responding ───────────────────────────
  // Before generating a response, recall relevant memories.
  const memories = await client.recall({
    query: 'What does the user prefer about communication style?',
    namespace: 'user-profile',
    limit: 5,
  });
  for (const m of memories.memories) {
    console.log(`  [${m.similarity.toFixed(2)}] ${m.content.slice(0, 80)}`);
  }

  // ── 4. Assemble context for LLM prompts ──────────────────────────
  // Build a context block to inject into system prompts.
  const ctx = await client.assembleContext({
    query: 'user preferences and recent conversations',
    max_memories: 10,
    max_tokens: 500,
    format: 'markdown',
  });
  console.log(`\nContext block (${ctx.token_estimate} tokens):\n${ctx.context.slice(0, 200)}...`);

  // ── 5. Ingest conversations automatically ─────────────────────────
  // After each conversation turn, extract and store facts.
  await client.ingest({
    messages: [
      { role: 'user', content: "I'm working on a Rust project called memoclaw-rs" },
      { role: 'assistant', content: "I'll remember that. What aspect are you working on?" },
      { role: 'user', content: 'The FFI bindings for Python' },
    ],
    namespace: 'conversations',
    agent_id: 'openclaw-main',
  });

  // ── 6. Consolidate during heartbeats ──────────────────────────────
  // Run periodically (e.g., in HEARTBEAT.md checks) to merge duplicates.
  const consolidated = await client.consolidate({ dry_run: true, namespace: 'conversations' });
  console.log(`\nConsolidation preview: ${consolidated.merged_count} memories would be merged`);

  // ── 7. Multi-agent namespace isolation ────────────────────────────
  // Each OpenClaw agent/subagent can use its own namespace.
  await client.store({
    content: 'CI pipeline for memoclaw-sdk uses GitHub Actions with Python 3.10-3.13 matrix',
    namespace: 'agent:backend',
    agent_id: 'backend-subagent',
    metadata: { tags: ['ci', 'infrastructure'] },
  });

  // ── 8. Core memories for quick access ─────────────────────────────
  // Get the most important memories without semantic search (free tier).
  const core = await client.coreMemories({ namespace: 'user-profile', limit: 5 });
  console.log(`\nCore memories: ${core.memories.length} found`);
  for (const m of core.memories) {
    console.log(`  [importance=${m.importance}] ${m.content.slice(0, 60)}`);
  }

  console.log('\nDone!');
}

main().catch(console.error);
