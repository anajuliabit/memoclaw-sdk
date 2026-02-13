# @memoclaw/sdk

Official TypeScript SDK for the [MemoClaw](https://memoclaw.com) memory API.

## Installation

```bash
npm install @memoclaw/sdk
# or
bun add @memoclaw/sdk
```

## Quick Start

```ts
import { MemoClawClient } from '@memoclaw/sdk';

const client = new MemoClawClient({
  wallet: '0xYourWalletAddress',
  // baseUrl: 'https://api.memoclaw.com', // default
});

// Store a memory
const stored = await client.store({
  content: 'Meeting notes: discussed Q1 roadmap',
  metadata: { tags: ['work', 'meetings'] },
  importance: 0.8,
});

// Recall memories
const results = await client.recall({
  query: 'What did we discuss about the roadmap?',
  limit: 5,
});

// Pin a memory (exempt from decay)
await client.update(stored.id, { pinned: true });

// List memories
const list = await client.list({ namespace: 'work', limit: 20 });

// Delete a memory
await client.delete(stored.id);

// Ingest a conversation
const ingested = await client.ingest({
  messages: [
    { role: 'user', content: 'I prefer dark mode and use vim' },
  ],
});

// Get suggestions
const suggestions = await client.suggested({ category: 'stale' });
```

## Authentication

MemoClaw uses wallet-based authentication. Pass your wallet address when creating the client — it's sent as the `X-Wallet` header on every request.

## API Reference

### `MemoClawClient`

| Method | Description |
|--------|-------------|
| `store(req)` | Store a single memory |
| `storeBatch(memories)` | Store up to 100 memories |
| `recall(req)` | Semantic memory search |
| `list(params?)` | List memories with pagination |
| `update(id, req)` | Update a memory by ID |
| `delete(id)` | Soft-delete a memory |
| `ingest(req)` | Auto-extract memories from conversations |
| `extract(req)` | Extract structured facts via LLM |
| `consolidate(req?)` | Merge similar memories by clustering |
| `createRelation(memoryId, req)` | Create a relationship between memories |
| `listRelations(memoryId)` | List relationships for a memory |
| `deleteRelation(memoryId, relationId)` | Delete a relationship |
| `status()` | Check free tier remaining calls |
| `suggested(params?)` | Get proactive memory suggestions |

### Error Handling

```ts
import { MemoClawError } from '@memoclaw/sdk';

try {
  await client.recall({ query: 'test' });
} catch (err) {
  if (err instanceof MemoClawError) {
    console.error(err.status, err.code, err.message);
  }
}
```

## License

MIT
