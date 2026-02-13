/**
 * Basic MemoClaw usage — store, recall, iterate, and graph traversal.
 */
import { MemoClawClient } from '@memoclaw/sdk';

const client = new MemoClawClient({ wallet: '0xYourWalletAddress' });

// Store a memory
const stored = await client.store({
  content: 'User prefers TypeScript over JavaScript',
  importance: 0.8,
  metadata: { tags: ['preferences', 'language'] },
  memory_type: 'preference',
  namespace: 'user-prefs',
});
console.log(`Stored: ${stored.id}`);

// Recall by semantic search
const recalled = await client.recall({ query: 'What programming language?', limit: 5 });
for (const mem of recalled.memories) {
  console.log(`  [${mem.similarity.toFixed(2)}] ${mem.content}`);
}

// Iterate over ALL memories (automatic pagination)
for await (const memory of client.listAll({ namespace: 'user-prefs', batchSize: 25 })) {
  console.log(`  ${memory.id}: ${memory.content.slice(0, 60)}...`);
}

// Graph traversal
const graph = await client.getMemoryGraph(stored.id, 2);
for (const [mid, relations] of graph) {
  console.log(`  ${mid}: ${relations.length} relations`);
}

// Middleware hooks (fluent API)
const loggedClient = new MemoClawClient({ wallet: '0x...' })
  .onBeforeRequest((method, path) => { console.log(`→ ${method} ${path}`); })
  .onAfterResponse((method, path) => { console.log(`← ${method} ${path} OK`); })
  .onError((method, path, err) => { console.error(`✗ ${method} ${path}: ${err.message}`); });

await loggedClient.store({ content: 'With logging!' });
