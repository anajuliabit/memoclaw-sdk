/**
 * Ingest a conversation and auto-extract memories.
 */
import { MemoClawClient } from '@memoclaw/sdk';

const client = new MemoClawClient({ wallet: '0xYourWalletAddress' });

// Ingest a conversation — MemoClaw auto-extracts facts
const result = await client.ingest({
  messages: [
    { role: 'user', content: "I'm working on a Rust project for blockchain indexing" },
    { role: 'assistant', content: 'That sounds interesting! What chain?' },
    { role: 'user', content: "Ethereum mainnet. I'm using Alloy for RPC calls." },
    { role: 'assistant', content: 'Great choice. Are you indexing events or traces?' },
    { role: 'user', content: 'Events for now, but I want to add trace support later.' },
  ],
  namespace: 'project-context',
  session_id: 'chat-2025-06-01',
});

console.log(`Extracted and stored memories`);
console.log(`Memory IDs:`, result.memory_ids);

// Recall project context later
const recall = await client.recall({
  query: 'What tech stack is the user using?',
  namespace: 'project-context',
});

for (const mem of recall.memories) {
  console.log(`  → ${mem.content}`);
}
