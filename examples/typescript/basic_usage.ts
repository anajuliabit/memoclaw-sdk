/**
 * Basic MemoClaw usage — store, recall, and iterate memories.
 */
import { MemoClawClient } from '@memoclaw/sdk';

const client = new MemoClawClient({ wallet: '0xYourWalletAddress' });

// Store a memory
const stored = await client.store({
  content: 'User prefers dark mode and vim keybindings',
  metadata: { tags: ['preferences', 'editor'] },
  importance: 0.8,
  memory_type: 'preference',
});
console.log(`Stored: ${stored.id} (tokens: ${stored.tokens_used})`);

// Semantic recall
const matches = await client.recall({
  query: 'what editor settings does the user like?',
  limit: 5,
});
for (const mem of matches.memories) {
  console.log(`  [${mem.similarity.toFixed(2)}] ${mem.content}`);
}

// Batch store
const batch = await client.storeBatch([
  { content: "User's timezone is UTC-5", memory_type: 'preference' },
  { content: 'Project deadline is March 2026', memory_type: 'project' },
]);
console.log(`Batch stored ${batch.count} memories`);

// Iterate all memories (auto-paginates)
console.log('\nAll memories:');
for await (const mem of client.iterMemories({ batchSize: 10 })) {
  console.log(`  [${mem.memory_type}] ${mem.content.slice(0, 60)}`);
}
