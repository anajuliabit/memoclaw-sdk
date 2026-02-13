"""Ingest a conversation and auto-extract facts as memories."""

from memoclaw import MemoClaw

client = MemoClaw()

# Ingest a conversation — MemoClaw extracts facts automatically
result = client.ingest(
    messages=[
        {"role": "user", "content": "I just moved to Berlin from São Paulo"},
        {"role": "assistant", "content": "Welcome to Berlin! How are you finding it?"},
        {"role": "user", "content": "Love it! I work remotely as a Solidity developer"},
        {"role": "assistant", "content": "That's great! Berlin has a strong web3 scene."},
    ],
    namespace="personal",
    auto_relate=True,
)
print(f"Extracted {result.facts_extracted} facts, stored {result.facts_stored}")
print(f"Created {result.relations_created} relations between memories")

# Now recall what we know
matches = client.recall("where does the user live?", namespace="personal")
for mem in matches.memories:
    print(f"  → {mem.content}")

client.close()
