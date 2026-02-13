/**
 * Real-world example: AI Assistant with persistent memory
 * 
 * This example demonstrates how to build an AI assistant that:
 * - Stores conversation history
 * - Recalls relevant past context
 * - Manages user preferences
 * - Handles memory consolidation
 * 
 * Run with: npx ts-node examples/typescript/ai_assistant_example.ts
 */

import { 
  MemoClawClient,
  RecallQuery,
  MemoryFilter,
  BatchStore,
} from '@memoclaw/sdk';

const client = new MemoClawClient({ 
  wallet: process.env.WALLET_ADDRESS || '0xYourWalletAddress'
});

// Simulated conversation messages
const conversation = [
  { role: 'user', content: 'I prefer dark mode in my IDE' },
  { role: 'assistant', content: 'Got it! I\'ll remember you prefer dark mode.' },
  { role: 'user', content: 'Also, I like Python more than JavaScript' },
  { role: 'assistant', content: 'Noted! Your preference for Python is saved.' },
  { role: 'user', content: 'Can you help me with a Django project?' },
  { role: 'assistant', content: 'Absolutely! I have experience with Django. What do you need help with?' },
];

async function main() {
  console.log('=== AI Assistant Memory Demo ===\n');

  // 1. Ingest conversation and auto-extract memories
  console.log('1. Ingesting conversation...');
  const ingest = await client.ingest({
    messages: conversation,
    namespace: 'ai-assistant',
    session_id: 'session-demo-001',
    auto_relate: true,
  });
  console.log(`   Extracted ${ingest.facts_extracted} facts, stored ${ingest.facts_stored}`);
  console.log(`   Created ${ingest.relations_created} relations\n`);

  // 2. Store user preferences explicitly with high importance
  console.log('2. Storing explicit preferences...');
  const pref1 = await client.store({
    content: 'User prefers dark mode in IDE',
    importance: 0.95,
    memory_type: 'preference',
    namespace: 'user-prefs',
    tags: ['preference', 'ide', 'ui'],
  });
  const pref2 = await client.store({
    content: 'User prefers Python over JavaScript',
    importance: 0.9,
    memory_type: 'preference',
    namespace: 'user-prefs',
    tags: ['preference', 'language'],
  });
  console.log(`   Stored: ${pref1.id}, ${pref2.id}\n`);

  // 3. Use builder pattern for complex recall
  console.log('3. Using RecallQuery builder...');
  const recallResults = await new RecallQuery(client)
    .withQuery('What are my IDE and language preferences?')
    .withLimit(5)
    .withNamespace('user-prefs')
    .withMinSimilarity(0.6)
    .includeRelations()
    .execute();
  
  console.log('   Found preferences:');
  for (const mem of recallResults.memories) {
    console.log(`   - [${mem.similarity.toFixed(2)}] ${mem.content}`);
  }
  console.log();

  // 4. Batch store project memories
  console.log('4. Batch storing project memories...');
  const projectMemories = [
    { content: 'Django REST Framework project', namespace: 'projects', memory_type: 'project' },
    { content: 'PostgreSQL database', namespace: 'projects', memory_type: 'project' },
    { content: 'Celery for async tasks', namespace: 'projects', memory_type: 'project' },
    { content: 'Redis for caching', namespace: 'projects', memory_type: 'project' },
    { content: 'Docker for containerization', namespace: 'projects', memory_type: 'project' },
  ];
  
  const store = new BatchStore(client);
  store.addMany(projectMemories);
  const batchResult = await store.execute();
  console.log(`   Stored ${batchResult.count} project memories\n`);

  // 5. Use MemoryFilter for iteration
  console.log('5. Using MemoryFilter to iterate...');
  const allPrefs = await new MemoryFilter(client)
    .withNamespace('user-prefs')
    .listAll();
  console.log(`   Found ${allPrefs.length} user preferences`);

  // 6. Graph traversal
  console.log('\n6. Memory graph traversal...');
  const graph = await client.getMemoryGraph(pref1.id, depth=2);
  console.log(`   Graph from "${pref1.id}":`);
  for (const [mid, relations] of graph) {
    console.log(`   - ${mid}: ${relations.length} relations`);
  }

  // 7. Suggested memories (decaying/stale)
  console.log('\n7. Getting suggested memories...');
  const suggested = await client.suggested({ limit: 5, category: 'stale' });
  console.log(`   Found ${suggested.total} stale memories`);

  // 8. Check free tier status
  console.log('\n8. Free tier status:');
  const status = await client.status();
  console.log(`   Remaining: ${status.free_tier_remaining}/${status.free_tier_total}`);

  console.log('\n=== Demo Complete ===');
}

main().catch(console.error);
