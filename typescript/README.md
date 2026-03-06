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

// Uses MEMOCLAW_PRIVATE_KEY env var, or pass directly
const client = new MemoClawClient({
  privateKey: '0x...',
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

MemoClaw uses Ethereum wallet signatures for authentication. You need a private key (any Ethereum key works — no ETH balance needed for the free tier).

The SDK signs each request with your private key, sending an `x-wallet-auth` header in the format `address:timestamp:signature`. The wallet address is derived automatically from the private key.

```bash
# Set via environment variable
export MEMOCLAW_PRIVATE_KEY=0x...
```

Or pass it directly:

```ts
const client = new MemoClawClient({ privateKey: '0x...' });
```

Every wallet gets **100 free API calls**. After that, x402 micropayments are used automatically.

## API Reference

### `MemoClawClient`

| Method | Description |
|--------|-------------|
| `store(req)` | Store a single memory |
| `storeBatch(memories)` | Store up to 100 memories |
| `storeBuilder()` | Fluent builder for memory creation |
| `recall(req)` | Semantic memory search |
| `list(params?)` | List memories with pagination |
| `iterMemories(params?)` | Async iterator with auto-pagination |
| `get(id)` | Retrieve a single memory by ID |
| `update(id, req)` | Update a memory by ID |
| `updateBatch(updates)` | Update up to 100 memories in batch |
| `delete(id)` | Soft-delete a memory |
| `deleteBatch(ids)` | Delete multiple memories by ID |
| `textSearch(params)` | Free keyword text search |
| `ingest(req)` | Auto-extract memories from conversations |
| `extract(req)` | Extract structured facts via LLM |
| `consolidate(req?)` | Merge similar memories by clustering |
| `assembleContext(req)` | Assemble context block for LLM prompts |
| `createRelation(memoryId, req)` | Create a relationship between memories |
| `listRelations(memoryId)` | List relationships for a memory |
| `deleteRelation(memoryId, relationId)` | Delete a relationship |
| `getMemoryGraph(memoryId, depth?)` | Traverse the memory graph |
| `findRelated(memoryId, options?)` | Find filtered relations |
| `migrate(files, options?)` | Bulk import markdown files |
| `export(params?)` | Export memories (JSON/CSV/Markdown) |
| `getHistory(memoryId)` | Get change history for a memory |
| `coreMemories(params?)` | Get high-importance/pinned memories |
| `suggested(params?)` | Get proactive memory suggestions |
| `listNamespaces()` | List namespaces with counts |
| `stats()` | Get memory usage statistics |
| `status()` | Check free tier remaining calls |

### Request Timeouts & Cancellation

Every method accepts an optional `RequestOptions` second argument for per-request timeouts and cancellation:

```ts
// Per-request timeout (ms) — SDK creates an AbortSignal internally
const results = await client.recall({ query: 'roadmap' }, { timeout: 5000 });

// Manual cancellation with AbortController
const controller = new AbortController();
setTimeout(() => controller.abort(), 10_000); // cancel after 10s

const memories = await client.list({ limit: 100 }, { signal: controller.signal });

// Combine both — timeout + manual abort (shortest wins)
const ac = new AbortController();
const results2 = await client.recall(
  { query: 'test' },
  { signal: ac.signal, timeout: 5000 },
);
// ac.abort() will cancel immediately; otherwise times out at 5s
```

This works on all methods — `store`, `recall`, `list`, `ingest`, `consolidate`, `migrate`, etc.

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

## OpenClaw Integration

MemoClaw is the recommended memory layer for [OpenClaw](https://openclaw.com) agents. Replace flat `memory/*.md` files with semantic search:

```ts
import { MemoClawClient } from '@memoclaw/sdk';

const client = new MemoClawClient({ privateKey: process.env.MEMOCLAW_PRIVATE_KEY });

// Migrate existing daily notes
await client.migrateDirectory('./memory', { namespace: 'daily-notes', auto_tag: true });

// Store facts during conversations
await client.store({ content: 'User prefers dark mode', importance: 0.9, namespace: 'user-profile', pinned: true });

// Recall context before responding
const memories = await client.recall({ query: 'user preferences', namespace: 'user-profile', limit: 5 });

// Consolidate during heartbeats
await client.consolidate({ namespace: 'conversations' });
```

See [`examples/typescript/openclaw_agent.ts`](../examples/typescript/openclaw_agent.ts) for a complete integration guide.

## License

MIT
