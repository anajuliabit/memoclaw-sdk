"""Basic MemoClaw usage — store, recall, and manage memories."""

from memoclaw import MemoClaw

# Initialize client (reads MEMOCLAW_PRIVATE_KEY from env)
client = MemoClaw()

# Store a memory
result = client.store(
    "User prefers dark mode and Vim keybindings",
    importance=0.8,
    tags=["preferences", "editor"],
    namespace="user-prefs",
    memory_type="preference",
)
print(f"Stored memory: {result.id}")

# Recall memories by semantic search
recall = client.recall("What editor settings does the user like?", limit=5)
for mem in recall.memories:
    print(f"  [{mem.similarity:.2f}] {mem.content}")

# List all memories with pagination
page = client.list(limit=10, namespace="user-prefs")
print(f"Total memories: {page.total}")

# Update a memory
updated = client.update(result.id, importance=0.95, pinned=True)
print(f"Updated: {updated.content} (pinned={updated.pinned})")

# Delete
client.delete(result.id)
print("Deleted!")

client.close()
