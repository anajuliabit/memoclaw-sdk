"""Basic MemoClaw usage — store, recall, and iterate memories."""

from memoclaw import MemoClaw

# Initialize (reads MEMOCLAW_PRIVATE_KEY from env)
client = MemoClaw()

# Store a memory
result = client.store(
    "User prefers dark mode and vim keybindings",
    tags=["preferences", "editor"],
    importance=0.8,
    memory_type="preference",
)
print(f"Stored: {result.id} (tokens: {result.tokens_used})")

# Semantic recall
matches = client.recall("what editor settings does the user like?", limit=5)
for mem in matches.memories:
    print(f"  [{mem.similarity:.2f}] {mem.content}")

# Batch store
batch = client.store_batch([
    {"content": "User's timezone is UTC-5", "memory_type": "preference"},
    {"content": "Project deadline is March 2026", "memory_type": "project"},
    {"content": "User prefers Python over JavaScript", "memory_type": "preference"},
])
print(f"Batch stored {batch.count} memories")

# Iterate all memories (auto-paginates)
print("\nAll memories:")
for mem in client.iter_memories(batch_size=10):
    print(f"  [{mem.memory_type}] {mem.content[:60]}")

client.close()
