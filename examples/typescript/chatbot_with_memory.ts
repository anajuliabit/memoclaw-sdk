/**
 * Example: Chatbot with memory - complete usage pattern
 * 
 * This example demonstrates a chatbot that:
 * 1. Stores user preferences and conversation context
 * 2. Recalls relevant memories when needed
 * 3. Uses batch operations for efficiency
 * 4. Implements proper error handling
 * 
 * Run with: npx tsx examples/typescript/chatbot_with_memory.ts
 */

import { 
  MemoClawClient, 
  MemoryBuilder, 
  RecallBuilder,
  NotFoundError,
  RateLimitError,
  MemoClawError,
} from './src/index.js';

// Use environment variable or set your wallet address
const WALLET = process.env.MEMOCLAW_WALLET || '0xyour-wallet-address';

class ChatbotWithMemory {
  readonly client: MemoClawClient;

  constructor(wallet: string) {
    this.client = new MemoClawClient({ 
      wallet,
      maxRetries: 3,
      retryDelay: 500,
    });
  }

  async storePreference(userId: string, preference: string, value: string): Promise<string> {
    const memory = new MemoryBuilder()
      .content(`User ${userId} prefers ${preference}: ${value}`)
      .importance(0.9)
      .tags(['preference', userId])
      .namespace('user-preferences')
      .build();
    
    const result = await this.client.store(memory);
    return result.id;
  }

  async storeConversationTurn(
    userId: string,
    sessionId: string,
    role: 'user' | 'assistant',
    content: string
  ): Promise<string> {
    const memory = new MemoryBuilder()
      .content(`[${role}]: ${content}`)
      .importance(0.5)
      .tags(['conversation', userId])
      .namespace('conversations')
      .session(sessionId)
      .build();
    
    const result = await this.client.store(memory);
    return result.id;
  }

  async recallPreferences(userId: string, limit = 5) {
    const params = new RecallBuilder()
      .query(`preferences for user ${userId}`)
      .limit(limit)
      .namespace('user-preferences')
      .minSimilarity(0.6)
      .build();
    
    return this.client.recall(params);
  }

  async getContext(userId: string, sessionId: string) {
    const params = new RecallBuilder()
      .query(`conversation context for user ${userId}`)
      .limit(10)
      .namespace('conversations')
      .session(sessionId)
      .includeRelations(true)
      .build();
    
    return this.client.recall(params);
  }

  async processMessage(
    userId: string,
    sessionId: string,
    userMessage: string,
    assistantResponse: string
  ): Promise<{ memoriesStored: number; memoryIds: string[] }> {
    const memoryIds: string[] = [];

    // Store user message
    const userMemId = await this.storeConversationTurn(
      userId, sessionId, 'user', userMessage
    );
    memoryIds.push(userMemId);

    // Store assistant response
    const assistantMemId = await this.storeConversationTurn(
      userId, sessionId, 'assistant', assistantResponse
    );
    memoryIds.push(assistantMemId);

    // Check if user expressed a preference
    const preferenceKeywords = ['prefer', 'like', 'hate', 'love', 'always', 'never'];
    if (preferenceKeywords.some(kw => userMessage.toLowerCase().includes(kw))) {
      const prefMemId = await this.storePreference(userId, 'expressed', userMessage);
      memoryIds.push(prefMemId);
    }

    return {
      memoriesStored: memoryIds.length,
      memoryIds,
    };
  }

  async close(): Promise<void> {
    // No explicit close needed for fetch-based client
  }
}

async function main() {
  const wallet = process.env.MEMOCLAW_WALLET;
  if (!wallet) {
    console.log('Set MEMOCLAW_WALLET env var to run this example');
    return;
  }

  const chatbot = new ChatbotWithMemory(wallet);

  try {
    // Simulate a conversation
    const userId = 'user-123';
    const sessionId = 'session-456';

    // Process a message
    const result = await chatbot.processMessage(
      userId,
      sessionId,
      'I prefer dark mode for coding',
      "Got it! I'll remember you prefer dark mode."
    );
    console.log(`Processed message, stored ${result.memoriesStored} memories`);

    // Recall preferences
    const prefs = await chatbot.recallPreferences(userId);
    console.log(`Found ${prefs.memories.length} preference memories`);

    // Get context
    const context = await chatbot.getContext(userId, sessionId);
    console.log(`Retrieved ${context.memories.length} context memories`);

    // Example using batch store
    const memories = Array.from({ length: 5 }, (_, i) => 
      new MemoryBuilder()
        .content(`Memory ${i}`)
        .namespace('batch-test')
        .build()
    );
    
    const batchResult = await chatbot.client.storeBatch(memories);
    console.log(`Stored ${batchResult.count} memories in batch`);

    // Iterate through all memories
    for await (const memory of chatbot.client.iterMemories({ namespace: 'batch-test' })) {
      console.log(`Found memory: ${memory.id}`);
    }

  } catch (error) {
    if (error instanceof NotFoundError) {
      console.error(`Memory not found: ${error.message}`);
    } else if (error instanceof RateLimitError) {
      console.error(`Rate limited: ${error.message}`);
    } else if (error instanceof MemoClawError) {
      console.error(`API error: ${error.code} - ${error.message}`);
    } else {
      console.error('Unexpected error:', error);
    }
  } finally {
    await chatbot.close();
  }
}

main();
