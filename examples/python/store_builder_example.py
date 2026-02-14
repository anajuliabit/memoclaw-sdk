"""Using StoreBuilder for fluent memory creation."""

from memoclaw import MemoClaw

client = MemoClaw()

# Method 1: Direct client call
result1 = client.store(
    "User prefers dark mode",
    importance=0.8,
    tags=["preferences", "ui"],
    namespace="user-prefs",
)

# Method 2: Using StoreBuilder - chain options fluently
result2 = (
    client.store_builder()
    .content("User prefers Vim keybindings")
    .importance(0.9)
    .add_tag("preferences")
    .add_tag("editor")
    .namespace("user-prefs")
    .memory_type("preference")
    .pinned(True)
    .execute()
)

print(f"Direct store: {result1.id}")
print(f"Builder store: {result2.id}")

client.close()
