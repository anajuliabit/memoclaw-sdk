# MemoClaw SDK Examples

Practical examples for the MemoClaw Python and TypeScript SDKs.

## Prerequisites

### Python

```bash
cd python
pip install -e ".[dev]"
```

You'll need a wallet private key or address. Set it via environment variable:

```bash
export MEMOCLAW_PRIVATE_KEY="0x..."
# or for read-only (free endpoints):
export MEMOCLAW_WALLET_ADDRESS="0x..."
```

### TypeScript

```bash
cd typescript
npm install
```

```bash
export MEMOCLAW_PRIVATE_KEY="0x..."
# or for read-only:
export MEMOCLAW_WALLET_ADDRESS="0x..."
```

## Examples

### Python

| Example | Description |
|---------|-------------|
| [`basic_usage.py`](python/basic_usage.py) | Store, recall, list, and delete memories |
| [`async_example.py`](python/async_example.py) | Async client usage with `asyncio` |
| [`chatbot_with_memory.py`](python/chatbot_with_memory.py) | Conversational chatbot with persistent memory |
| [`ai_assistant_example.py`](python/ai_assistant_example.py) | AI assistant with memory-augmented responses |
| [`conversation_ingest.py`](python/conversation_ingest.py) | Ingest and extract memories from conversations |
| [`graph_traversal.py`](python/graph_traversal.py) | Memory relations and graph traversal |
| [`middleware_and_hooks.py`](python/middleware_and_hooks.py) | Request/response hooks and middleware patterns |
| [`openclaw_agent.py`](python/openclaw_agent.py) | OpenClaw agent integration |
| [`pagination_and_graph.py`](python/pagination_and_graph.py) | Paginated listing and graph queries |
| [`store_builder_example.py`](python/store_builder_example.py) | Fluent builder pattern for storing memories |

### TypeScript

| Example | Description |
|---------|-------------|
| [`basic_usage.ts`](typescript/basic_usage.ts) | Store, recall, list, and delete memories |
| [`advanced_usage.ts`](typescript/advanced_usage.ts) | Advanced patterns: batching, namespaces, types |
| [`chatbot_with_memory.ts`](typescript/chatbot_with_memory.ts) | Conversational chatbot with persistent memory |
| [`ai_assistant_example.ts`](typescript/ai_assistant_example.ts) | AI assistant with memory-augmented responses |
| [`conversation_ingest.ts`](typescript/conversation_ingest.ts) | Ingest and extract memories from conversations |
| [`graph_traversal.ts`](typescript/graph_traversal.ts) | Memory relations and graph traversal |
| [`middleware_and_hooks.ts`](typescript/middleware_and_hooks.ts) | Request/response hooks and middleware patterns |
| [`openclaw_agent.ts`](typescript/openclaw_agent.ts) | OpenClaw agent integration |
| [`pagination_and_graph.ts`](typescript/pagination_and_graph.ts) | Paginated listing and graph queries |
| [`store_builder.ts`](typescript/store_builder.ts) | Fluent builder pattern for storing memories |

## Running Examples

### Python

```bash
python examples/python/basic_usage.py
```

### TypeScript

```bash
npx ts-node examples/typescript/basic_usage.ts
# or with tsx:
npx tsx examples/typescript/basic_usage.ts
```

## Common Patterns

### Wallet-only mode (free endpoints)

Both SDKs support wallet-only mode for free endpoints (list, get, delete, search):

```python
from memoclaw import MemoClaw
client = MemoClaw(wallet_address="0x...")
memories = client.list()
```

```typescript
import { MemoClawClient } from 'memoclaw';
const client = new MemoClawClient({ walletAddress: '0x...' });
const memories = await client.list();
```

### Namespaces

Isolate memories per project or context:

```python
client.store("Project A note", namespace="project-a")
client.recall("status update", namespace="project-a")
```

### Memory-efficient export

For large memory sets, use the paginated iterator instead of `export()`:

```python
for memory in client.iter_export(batch_size=100, namespace="my-project"):
    process(memory)
```

```typescript
for await (const memory of client.iterExport({ batchSize: 100, namespace: 'my-project' })) {
  process(memory);
}
```

## Links

- [Documentation](https://docs.memoclaw.com)
- [API Reference](https://api.memoclaw.com)
- [GitHub](https://github.com/anajuliabit/memoclaw-sdk)
