"""Example: Chatbot with memory - complete usage pattern.

This example demonstrates a chatbot that:
1. Stores user preferences and conversation context
2. Recalls relevant memories when needed
3. Uses batch operations for efficiency
4. Implements proper error handling

Run with: python examples/python/chatbot_with_memory.py
"""

import os
from typing import Optional

# Use environment variable or set your private key
# export MEMOCLAW_PRIVATE_KEY="0x..."
from memoclaw import (
    AsyncMemoClaw,
    MemoClaw,
    MemoryBuilder,
    RecallBuilder,
    NotFoundError,
    RateLimitError,
    APIError,
)


class ChatbotWithMemory:
    """A chatbot that remembers user preferences and context."""

    def __init__(self, private_key: Optional[str] = None):
        self.private_key = private_key or os.environ.get("MEMOCLAW_PRIVATE_KEY")
        if not self.private_key:
            raise ValueError("Private key required. Set MEMOCLAW_PRIVATE_KEY env var.")
        
        # Use connection pooling for better performance
        self.client = MemoClaw(
            private_key=self.private_key,
            pool_max_connections=20,
            pool_max_keepalive=10,
        )

    def store_preference(self, user_id: str, preference: str, value: str) -> str:
        """Store a user preference."""
        memory = (
            MemoryBuilder()
            .content(f"User {user_id} prefers {preference}: {value}")
            .importance(0.9)
            .tags(["preference", user_id])
            .namespace("user-preferences")
            .build()
        )
        result = self.client.store(**memory.to_dict())
        return result.id

    def store_conversation_turn(
        self,
        user_id: str,
        session_id: str,
        role: str,
        content: str,
    ) -> str:
        """Store a conversation turn for context."""
        memory = (
            MemoryBuilder()
            .content(f"[{role}]: {content}")
            .importance(0.5)
            .tags(["conversation", user_id])
            .namespace("conversations")
            .session(session_id)
            .build()
        )
        result = self.client.store(**memory.to_dict())
        return result.id

    def recall_preferences(self, user_id: str, limit: int = 5):
        """Recall user preferences."""
        params = (
            RecallBuilder()
            .query(f"preferences for user {user_id}")
            .limit(limit)
            .namespace("user-preferences")
            .min_similarity(0.6)
            .build()
        )
        return self.client.recall(**params)

    def get_context(self, user_id: str, session_id: str) -> list:
        """Get relevant context for a conversation."""
        params = (
            RecallBuilder()
            .query(f"conversation context for user {user_id}")
            .limit(10)
            .namespace("conversations")
            .session(session_id)
            .include_relations(True)
            .build()
        )
        response = self.client.recall(**params)
        return response.memories

    def process_message(
        self,
        user_id: str,
        session_id: str,
        user_message: str,
        assistant_response: str,
    ) -> dict:
        """Process a message exchange and store in memory."""
        memories_stored = []

        # Store user message
        user_mem_id = self.store_conversation_turn(
            user_id, session_id, "user", user_message
        )
        memories_stored.append(user_mem_id)

        # Store assistant response
        assistant_mem_id = self.store_conversation_turn(
            user_id, session_id, "assistant", assistant_response
        )
        memories_stored.append(assistant_mem_id)

        # Check if user expressed a preference
        preference_keywords = ["prefer", "like", "hate", "love", "always", "never"]
        if any(kw in user_message.lower() for kw in preference_keywords):
            # Store as preference with higher importance
            pref_mem_id = self.store_preference(user_id, "expressed", user_message)
            memories_stored.append(pref_mem_id)

        return {
            "memories_stored": len(memories_stored),
            "memory_ids": memories_stored,
        }

    def close(self):
        """Clean up resources."""
        self.client.close()


async def async_example():
    """Example using async client for better concurrency."""
    client = AsyncMemoClaw(
        private_key=os.environ.get("MEMOCLAW_PRIVATE_KEY"),
        pool_max_connections=20,
    )

    try:
        # Batch store multiple memories
        from memoclaw import MemoryBuilder, StoreInput
        
        memories = [
            MemoryBuilder()
            .content(f"Memory {i}")
            .namespace("batch-test")
            .build()
            for i in range(5)
        ]
        
        # Convert to dicts for batch
        memory_dicts = [m.model_dump(exclude_none=True) for m in memories]
        result = await client.store_batch(memory_dicts)
        print(f"Stored {result.count} memories in batch")

        # Async iterate through all memories
        async for memory in client.iter_memories(namespace="batch-test"):
            print(f"Found memory: {memory.id}")

    finally:
        await client.close()


def main():
    """Run the chatbot example."""
    private_key = os.environ.get("MEMOCLAW_PRIVATE_KEY")
    if not private_key:
        print("Set MEMOCLAW_PRIVATE_KEY env var to run this example")
        return

    chatbot = ChatbotWithMemory(private_key)

    try:
        # Simulate a conversation
        user_id = "user-123"
        session_id = "session-456"

        # Process messages
        result = chatbot.process_message(
            user_id,
            session_id,
            "I prefer dark mode for coding",
            "Got it! I'll remember you prefer dark mode.",
        )
        print(f"Processed message, stored {result['memories_stored']} memories")

        # Recall preferences
        prefs = chatbot.recall_preferences(user_id)
        print(f"Found {len(prefs.memories)} preference memories")

        # Get context
        context = chatbot.get_context(user_id, session_id)
        print(f"Retrieved {len(context)} context memories")

    except NotFoundError as e:
        print(f"Memory not found: {e}")
    except RateLimitError as e:
        print(f"Rate limited: {e}")
    except APIError as e:
        print(f"API error: {e}")
    finally:
        chatbot.close()


if __name__ == "__main__":
    main()
