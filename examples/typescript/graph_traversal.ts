/**
 * Example: Memory Graph Traversal
 * 
 * This example demonstrates how to traverse the memory graph
 * to find related memories and understand connections.
 * 
 * Run with: npx tsx examples/typescript/graph_traversal.ts
 */

import { MemoClawClient, MemoryFilter, RelationBuilder } from '../src/index.js';

// Initialize client with your wallet
const client = new MemoClawClient({
  wallet: process.env.MEMOCLAW_WALLET || '0x...',
  baseUrl: process.env.MEMOCLAW_BASE_URL,
});

async function main() {
  console.log('=== Memory Graph Traversal Example ===\n');

  // First, let's store some memories with relations
  console.log('1. Storing memories and creating relations...\n');

  // Store source memories
  const mem1 = await client.store({
    content: 'User prefers dark mode for IDE',
    importance: 0.8,
    memory_type: 'preference',
    namespace: 'user-settings',
  });

  const mem2 = await client.store({
    content: 'User prefers VS Code over IntelliJ',
    importance: 0.7,
    memory_type: 'preference',
    namespace: 'user-settings',
  });

  const mem3 = await client.store({
    content: 'User is a Python developer',
    importance: 0.9,
    memory_type: 'observation',
    namespace: 'user-settings',
  });

  const mem4 = await client.store({
    content: 'User works on machine learning projects',
    importance: 0.8,
    memory_type: 'observation',
    namespace: 'user-settings',
  });

  console.log(`Created memories: ${mem1.id}, ${mem2.id}, ${mem3.id}, ${mem4.id}`);

  // Create relations between memories
  console.log('\n2. Creating relations between memories...\n');

  await new RelationBuilder(client, mem1.id)
    .relateTo(mem2.id, 'supports')
    .relateTo(mem3.id, 'related_to')
    .createAll();

  await new RelationBuilder(client, mem3.id)
    .relateTo(mem4.id, 'related_to')
    .createAll();

  console.log('Relations created successfully');

  // Find directly related memories
  console.log('\n3. Finding directly related memories...\n');

  const related = await client.findRelated(mem1.id);
  console.log(`Found ${related.length} direct relations for "${mem1.id}":`);
  for (const rel of related) {
    console.log(`  - ${rel.relation_type}: ${rel.memory.content}`);
  }

  // Traverse the graph to depth 2
  console.log('\n4. Traversing graph to depth 2...\n');

  const graph = await client.getMemoryGraph(mem1.id, depth=2);
  console.log(`Visited ${graph.size} nodes in the graph:`);
  
  for (const [memoryId, relations] of graph.entries()) {
    console.log(`\n  Memory: ${memoryId}`);
    console.log(`  Relations: ${relations.length}`);
    for (const rel of relations) {
      console.log(`    - [${rel.relation_type}] ${rel.memory.content}`);
    }
  }

  // Filter and find specific relation types
  console.log('\n5. Finding specific relation types...\n');

  const supporting = await client.findRelated(mem1.id, { 
    relationType: 'supports' 
  });
  console.log(`Found ${supporting.length} 'supports' relations:`);
  for (const rel of supporting) {
    console.log(`  - ${rel.memory.content}`);
  }

  // Use MemoryFilter with graph traversal
  console.log('\n6. Using MemoryFilter with namespace...\n');

  const memories = await new MemoryFilter(client)
    .withNamespace('user-settings')
    .listAll();

  console.log(`Found ${memories.length} memories in 'user-settings' namespace:`);
  for (const mem of memories) {
    console.log(`  - ${mem.content.substring(0, 50)}...`);
  }

  console.log('\n=== Example Complete ===');
}

main().catch(console.error);
