# MemoClaw Python SDK

Official Python SDK for the [MemoClaw](https://memoclaw.com) memory API — semantic memory for AI agents.

## Installation

```bash
pip install memoclaw
```

To enable automatic x402 payments (when free tier is exhausted):

```bash
pip install "memoclaw[x402]"
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

Every wallet gets **1,000 free API calls**. After that, the SDK automatically handles x402 micropayments if `x402` extras are installed.

## Async Support

```python
from memoclaw import AsyncMemoClaw

async def main():
    async with AsyncMemoClaw() as client:
        result = await client.store("Async memory")
        memories = await client.recall("async")
```

## All Methods

| Method | Description |
|--------|-------------|
| `store(content, **kwargs)` | Store a single memory |
| `store_batch(memories)` | Store up to 100 memories |
| `recall(query, **kwargs)` | Semantic search |
| `list(**kwargs)` | List memories with pagination |
| `update(memory_id, **kwargs)` | Update a memory |
| `delete(memory_id)` | Delete a memory |
| `ingest(**kwargs)` | Auto-extract facts from conversation |
| `extract(messages, **kwargs)` | Extract structured facts via LLM |
| `consolidate(**kwargs)` | Merge similar memories |
| `suggested(**kwargs)` | Get proactive memory suggestions |
| `create_relation(memory_id, target_id, relation_type)` | Create a relationship |
| `list_relations(memory_id)` | List relationships |
| `delete_relation(memory_id, relation_id)` | Delete a relationship |
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

## License

MIT
# SDK
