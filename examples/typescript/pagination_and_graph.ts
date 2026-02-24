/**
 * Pagination iterators and memory graph traversal.
 */
import { MemoClawClient } from '@memoclaw/sdk';

const client = new MemoClawClient({ wallet: '0xYourWalletAddress' });

// iterMemories() handles pagination automatically
let count = 0;
for await (const memory of client.iterMemories({ batchSize: 25, namespace: 'default' })) {
  console.log(`  ${memory.id}: ${memory.content.slice(0, 60)}...`);
  count++;
}
console.log(`Iterated over ${count} memories`);

// Graph traversal — find related memories up to 2 hops away
const graph = await client.getMemoryGraph('mem-123', 2);
for (const [mid, relations] of graph.entries()) {
  console.log(`  ${mid}: ${relations.length} relations`);
  for (const rel of relations) {
    console.log(`    → ${rel.relation_type} → ${rel.memory.content.slice(0, 40)}...`);
  }
}

// Filter relations by type
const contradictions = await client.findRelated('mem-123', { relationType: 'contradicts' });
console.log(`Found ${contradictions.length} contradictions`);
