/**
 * Advanced usage example for MemoClaw SDK
 * Demonstrates hooks, middleware, streaming, and graph traversal
 */

import {
  MemoClawClient,
  StoreBuilder,
  RecallQuery,
  MemoryFilter,
  BatchStore,
  RelationBuilder,
} from '../src/index.js';
import type { Memory, RecallResponse } from '../src/index.js';

const WALLET = process.env.MEMOCLAW_WALLET || '0x...';

async function main() {
  // ── Basic Client Setup ─────────────────────────────────────
  
  const client = new MemoClawClient({
    wallet: WALLET,
    maxRetries: 3,
    retryDelay: 1000,
  });

  // ── Hooks / Middleware ─────────────────────────────────────
  
  // Log all requests
  client.onBeforeRequest((method, path, body) => {
    console.log(`→ ${method} ${path}`, body ? JSON.stringify(body).slice(0, 100) : '');
    return body; // Can modify body
  });

  // Log all responses
  client.onAfterResponse((method, path, data) => {
    console.log(`← ${method} ${path}`);
    return data; // Can modify response
  });

  // Log errors
  client.onError((method, path, error) => {
    console.error(`✗ ${method} ${path}: ${error.message}`);
  });

  // ── Store Builder Pattern ───────────────────────────────────
  
  // Using the fluent builder
  const result = await new StoreBuilder(client)
    .content('User prefers dark mode in their IDE')
    .importance(0.9)
    .tags(['preference', 'ui', 'ide'])
    .namespace('user-preferences')
    .memoryType('preference')
    .execute();
  
  console.log('Stored memory:', result.id);

  // ── Batch Store ────────────────────────────────────────────
  
  const batch = new BatchStore(client);
  
  // Add many memories at once
  const userPreferences = [
    { content: 'User prefers VS Code', importance: 0.8 },
    { content: 'User uses TypeScript', importance: 0.7 },
    { content: 'User likes minimal UI', importance: 0.6 },
    { content: 'User prefers terminal over GUI', importance: 0.5 },
    { content: 'User has large monitor setup', importance: 0.4 },
  ];
  
  for (const pref of userPreferences) {
    batch.add(pref.content, { importance: pref.importance });
  }
  
  // Also add many at once
  batch.addMany([
    { content: 'User prefers Python over Java' },
    { content: 'User likes coffee while coding' },
  ]);
  
  const batchResult = await batch.execute();
  console.log(`Stored ${batchResult.count} memories`);

  // ── Recall Query ───────────────────────────────────────────
  
  // Using the fluent recall query builder
  const recallResults = await new RecallQuery(client)
    .withQuery('user preferences for coding environment')
    .withLimit(5)
    .withMinSimilarity(0.6)
    .withNamespace('user-preferences')
    .includeRelations()
    .execute();
  
  console.log(`Found ${recallResults.memories.length} memories`);
  for (const mem of recallResults.memories) {
    console.log(`  - ${mem.content} (similarity: ${mem.similarity.toFixed(2)})`);
  }

  // Or use direct recall
  const directRecall = await client.recall({
    query: 'IDE preferences',
    limit: 10,
    namespace: 'user-preferences',
    filters: {
      tags: ['preference'],
    },
  });

  // ── Search Alias ────────────────────────────────────────────
  
  // 'search' is an alias for 'recall' - matches Mem0/Pinecone API
  const searchResults = await client.search({
    query: 'dark mode',
    limit: 5,
  });

  // ── List & Iterate Memories ──────────────────────────────────
  
  // List with pagination
  const listResult = await client.list({
    namespace: 'user-preferences',
    limit: 20,
    offset: 0,
  });
  
  console.log(`Total memories: ${listResult.total}`);
  
  // Or iterate over all memories (auto-pagination)
  let count = 0;
  for await (const memory of client.iterMemories({ namespace: 'user-preferences' })) {
    count++;
    console.log(`Memory ${count}: ${memory.content.slice(0, 50)}...`);
  }

  // Using MemoryFilter builder
  const filter = new MemoryFilter(client)
    .withNamespace('user-preferences')
    .withTags(['preference']);
  
  const allMemories = await filter.listAll();
  const memoryCount = await filter.count();
  console.log(`Found ${memoryCount} preference memories`);

  // ── Graph Traversal ─────────────────────────────────────────
  
  // Get the first memory ID from earlier
  const memoryId = result.id;
  
  // Get memory graph (relations up to N hops)
  const graph = await client.getMemoryGraph(memoryId, depth=2);
  console.log(`Graph has ${graph.size} nodes`);
  
  // Find related memories
  const related = await client.findRelated(memoryId, {
    relationType: 'related_to',
    direction: 'outgoing',
  });
  
  // Create relations using the builder
  if (related.length > 0) {
    const relationResults = await new RelationBuilder(client, memoryId)
      .relateTo(related[0].memory.id, 'related_to')
      .relateTo(related[0].memory.id, 'supports')
      .createAll();
  }

  // ── Ingest Conversation ─────────────────────────────────────
  
  const messages = [
    { role: 'user', content: 'I prefer working in the morning' },
    { role: 'assistant', content: 'Noted. I will remember you are a morning person.' },
    { role: 'user', content: 'Also, I like classical music while coding' },
    { role: 'assistant', content: 'Great! Classical music added to your preferences.' },
  ];
  
  const ingestResult = await client.ingest({
    messages,
    namespace: 'user-preferences',
    auto_relate: true,
  });
  
  console.log(`Ingested ${ingestResult.facts_extracted} facts, stored ${ingestResult.facts_stored} memories`);

  // ── Extract & Consolidate ───────────────────────────────────
  
  // Extract structured facts from conversation
  const extractResult = await client.extract({
    messages: [
      { role: 'user', content: 'I prefer dark theme, Python, and Vim' },
    ],
    namespace: 'user-preferences',
  });
  
  // Consolidate similar memories
  const consolidateResult = await client.consolidate({
    namespace: 'user-preferences',
    min_similarity: 0.9,
    dry_run: false,
  });
  
  console.log(`Consolidated ${consolidateResult.merged} memories into ${consolidateResult.clusters} clusters`);

  // ── Update & Delete ─────────────────────────────────────────
  
  // Update a memory
  const updated = await client.update(memoryId, {
    content: 'Updated: User prefers dark mode in their IDE (confirmed)',
    importance: 0.95,
  });
  
  // Delete a memory
  const deleteResult = await client.delete(memoryId);
  console.log(`Deleted: ${deleteResult.deleted}`);

  // Delete multiple in batch
  const batchDeleteResult = await client.deleteBatch(['id1', 'id2', 'id3']);
  console.log(`Batch deleted ${batchDeleteResult.filter(r => r.deleted).length} memories`);

  // ── Status & Suggestions ────────────────────────────────────
  
  // Check free tier status
  const status = await client.status();
  console.log(`Free tier remaining: ${status.free_tier_remaining} / ${status.free_tier_total}`);
  
  // Get suggested memories to review
  const suggested = await client.suggested({
    limit: 10,
    category: 'stale',
  });
  
  console.log(`Suggested ${suggested.suggested.length} memories for review`);
  console.log('Categories:', suggested.categories);

  // ── Error Handling ──────────────────────────────────────────
  
  try {
    await client.get('nonexistent-id');
  } catch (error) {
    if (error instanceof MemoClawError) {
      console.error(`Error: ${error.code} - ${error.message}`);
      if (error.suggestion) {
        console.error(`💡 Suggestion: ${error.suggestion}`);
      }
    }
  }

  // ── Context Manager Pattern (ES2024+) ───────────────────────
  // Note: Requires TypeScript target ES2024+ and lib ESNext
  
  // Option 1: Disposable pattern
  {
    using wrapper = MemoClawClient.disposable({ wallet: WALLET });
    await wrapper.client.store({ content: 'Temporary memory' });
    // Automatically cleaned up at end of block
  }

  // Option 2: Manual dispose
  client.dispose();

  console.log('All examples completed!');
}

main().catch(console.error);
