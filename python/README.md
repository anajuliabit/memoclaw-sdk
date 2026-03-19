# MemoClaw Python SDK

Official Python SDK for the [MemoClaw](https://memoclaw.com) memory API — semantic memory for AI agents.

## Installation

```bash
pip install memoclaw
```

With optional extras:

```bash
pip install "memoclaw[x402]"            # automatic x402 payments
pip install "memoclaw[langchain]"       # LangChain integration
pip install "memoclaw[llamaindex]"      # LlamaIndex integration
pip install "memoclaw[pydantic-ai]"      # Pydantic AI integration
pip install "memoclaw[x402,langchain,llamaindex,pydantic-ai]"  # all extras
```

## Quickstart

```python
from memoclaw import MemoClaw

# Uses MEMOCLAW_PRIVATE_KEY env var, or pass directly
client = MemoClaw(private_key="0x...")

# Store a memory
result = client.store(
    "User prefers dark mode and tabs over spaces",
    importance=0.8,
    tags=["preferences", "editor"],
)
print(result.id)  # mem-abc-123

# Recall memories by semantic search
memories = client.recall("code editor preferences", limit=5)
for m in memories.memories:
    print(f"{m.content} (similarity: {m.similarity:.2f})")

# Update a memory
updated = client.update(result.id, importance=0.95)

# Delete a memory
client.delete(result.id)
```

## Authentication

MemoClaw uses Ethereum wallet signatures for authentication. You need a private key (any Ethereum key works — no ETH balance needed for the free tier).

```bash
# Generate a new key (one-time)
python -c "from eth_account import Account; a = Account.create(); print(f'MEMOCLAW_PRIVATE_KEY={a.key.hex()}')"
```

Set the environment variable:

```bash
export MEMOCLAW_PRIVATE_KEY=0x...
```

Every wallet gets **100 free API calls**. After that, the SDK automatically handles x402 micropayments if `x402` extras are installed.

## Async Support

```python
from memoclaw import AsyncMemoClaw

async def main():
    async with AsyncMemoClaw() as client:
        result = await client.store("Async memory")
        memories = await client.recall("async")
```

## Lifecycle Callbacks

Both clients support high-level memory lifecycle callbacks that fire after specific operations.
Use these to tag memories, send analytics, or trigger side effects without reimplementing SDK logic.

```python
from memoclaw import MemoClaw

client = MemoClaw(private_key="0x...")
client.on_store(lambda result: print(f"Stored {result.id}"))
client.on_recall(lambda query, resp: print(f"recall {query} -> {len(resp.memories)} results"))
client.on_delete(lambda memory_id, _: print(f"Deleted {memory_id}"))
```

`AsyncMemoClaw` supports `async def` callbacks — awaited automatically after each operation.

## Pydantic AI Integration

Install the extra dependencies and register MemoClaw tools directly on a Pydantic AI agent.

```python
from pydantic_ai import Agent
from memoclaw import MemoClaw
from memoclaw.integrations.pydantic_ai import (
    MemoClawDeps,
    memoclaw_store_tool,
    memoclaw_recall_tool,
)

agent = Agent(
    "gpt-4o-mini",
    deps=MemoClawDeps(
        client=MemoClaw(),
        namespace="support",
    ),
    tools=[
        memoclaw_store_tool(),
        memoclaw_recall_tool(),
    ],
)

response = agent.run_sync("Remember that Carla prefers morning stand-ups.")
print(response.output)
```

## All Methods

| Method | Description |
|--------|-------------|
| `store(content, **kwargs)` | Store a single memory |
| `store_batch(memories)` | Store up to 100 memories |
| `store_builder()` | Fluent builder for memory creation |
| `recall(query, **kwargs)` | Semantic search |
| `list(**kwargs)` | List memories with pagination |
| `iter_memories(**kwargs)` | Iterator with auto-pagination |
| `get(memory_id)` | Retrieve a single memory by ID |
| `update(memory_id, **kwargs)` | Update a memory |
| `update_batch(updates)` | Update up to 100 memories in batch |
| `delete(memory_id)` | Delete a memory |
| `delete_batch(ids)` | Delete multiple memories by ID |
| `text_search(query, **kwargs)` | Free keyword text search |
| `ingest(**kwargs)` | Auto-extract facts from conversation |
| `extract(messages, **kwargs)` | Extract structured facts via LLM |
| `consolidate(**kwargs)` | Merge similar memories |
| `assemble_context(query, **kwargs)` | Assemble context block for LLM prompts |
| `create_relation(memory_id, target_id, relation_type)` | Create a relationship |
| `list_relations(memory_id)` | List relationships |
| `delete_relation(memory_id, relation_id)` | Delete a relationship |
| `get_memory_graph(memory_id, depth)` | Traverse the memory graph |
| `find_related(memory_id, **kwargs)` | Find filtered relations |
| `migrate(files, **kwargs)` | Bulk import markdown files |
| `export(**kwargs)` | Export memories (JSON/CSV/Markdown) |
| `get_history(memory_id)` | Get change history for a memory |
| `core_memories(**kwargs)` | Get high-importance/pinned memories |
| `suggested(**kwargs)` | Get proactive memory suggestions |
| `list_namespaces()` | List namespaces with counts |
| `stats()` | Get memory usage statistics |
| `status()` | Check free tier remaining calls |

## Error Handling

```python
from memoclaw import MemoClaw, NotFoundError, RateLimitError

client = MemoClaw()

try:
    client.delete("nonexistent-id")
except NotFoundError as e:
    print(f"Memory not found: {e.message}")
except RateLimitError as e:
    print(f"Rate limited: {e.message}")
```

## Configuration

```python
client = MemoClaw(
    private_key="0x...",               # or MEMOCLAW_PRIVATE_KEY env var
    base_url="http://localhost:3000",   # for local development
    timeout=60.0,                       # request timeout in seconds
)
```

### Connection pooling controls

```python
client = MemoClaw(
    private_key="0x...",
    warm_pool=True,                    # eager TCP/TLS warm-up on init
    pool_recycle_seconds=300,          # recycle idle sockets every 5 minutes
)
print(client.pool_health())           # {"active_connections": 0, ...}
```

For async workflows use `await AsyncMemoClaw.create(..., warm_pool=True)` and
`await client.warm_pool()` to refresh the pool on demand.

## OpenClaw Integration

MemoClaw is the recommended memory layer for [OpenClaw](https://openclaw.com) agents. Replace flat `memory/*.md` files with semantic search:

```python
from memoclaw import MemoClaw

client = MemoClaw()

# Migrate existing daily notes
client.migrate_directory("memory/", namespace="daily-notes", auto_tag=True)

# Store facts during conversations
client.store("User prefers dark mode", importance=0.9, namespace="user-profile", pinned=True)

# Recall context before responding
memories = client.recall("user preferences", namespace="user-profile", limit=5)

# Consolidate during heartbeats
client.consolidate(namespace="conversations")
```

See [`examples/python/openclaw_agent.py`](../examples/python/openclaw_agent.py) for a complete integration guide.

## License

MIT
# SDK
