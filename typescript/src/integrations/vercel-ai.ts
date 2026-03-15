/**
 * Vercel AI SDK integration for MemoClaw.
 *
 * Provides helper utilities for using MemoClaw with the Vercel AI SDK
 * (`ai` package) for `generateText` and `streamText` workflows.
 *
 * @example Basic context injection
 * ```typescript
 * import { MemoClawClient } from '@memoclaw/sdk';
 * import { createMemoryContext } from '@memoclaw/sdk/vercel-ai';
 * import { generateText } from 'ai';
 *
 * const client = await MemoClawClient.create({ privateKey: '0x...' });
 * const memoryContext = createMemoryContext(client, { namespace: 'my-project' });
 *
 * const { text } = await generateText({
 *   model: yourModel,
 *   system: await memoryContext.getSystemPrompt('Tell me about the user'),
 *   prompt: 'What do you know about my preferences?',
 * });
 *
 * // After the conversation, store new memories
 * await memoryContext.storeMessage('user', 'I prefer dark mode');
 * await memoryContext.storeMessage('assistant', text);
 * ```
 *
 * @module
 */

import type { MemoClawClient } from '../client.js';
import type { RecallMemory, StoreRequest } from '../types.js';

// ── Memory Context ──────────────────────────────────────────────────────────

export interface MemoryContextOptions {
  /** Optional MemoClaw namespace for isolation. */
  namespace?: string;
  /** Optional session ID for conversation scoping. */
  sessionId?: string;
  /** Optional agent ID. */
  agentId?: string;
  /** Maximum memories to include in context (default: 10). */
  maxMemories?: number;
  /** Minimum similarity threshold for recall (default: 0.5). */
  minSimilarity?: number;
  /** Whether to include related memories (default: false). */
  includeRelations?: boolean;
}

export interface MemoryContext {
  /**
   * Recall memories relevant to a query and format them as a system prompt section.
   *
   * @param query - The query to search for relevant memories
   * @param preamble - Optional text to prepend before the memories section
   * @returns A formatted string with recalled memories ready for a system prompt
   */
  getSystemPrompt(query: string, preamble?: string): Promise<string>;

  /**
   * Recall raw memories relevant to a query.
   *
   * @param query - The query to search for relevant memories
   * @returns Array of recalled memories with metadata
   */
  recall(query: string): Promise<RecallMemory[]>;

  /**
   * Store a conversation message as a memory.
   *
   * @param role - The role of the message sender ('user', 'assistant', 'system')
   * @param content - The message content
   * @param importance - Optional importance score (0.0–1.0)
   * @returns The stored memory ID
   */
  storeMessage(role: string, content: string, importance?: number): Promise<string>;

  /**
   * Store an arbitrary memory.
   *
   * @param content - The memory content
   * @param options - Additional store options
   * @returns The stored memory ID
   */
  store(content: string, storeOptions?: Partial<StoreRequest>): Promise<string>;
}

/**
 * Create a memory context helper for Vercel AI SDK workflows.
 *
 * Provides methods to recall relevant memories and format them as
 * system prompts, as well as store new conversation messages.
 */
export function createMemoryContext(client: MemoClawClient, options: MemoryContextOptions = {}): MemoryContext {
  const {
    namespace,
    sessionId,
    agentId,
    maxMemories = 10,
    minSimilarity = 0.5,
    includeRelations = false,
  } = options;

  return {
    async getSystemPrompt(query: string, preamble?: string): Promise<string> {
      const response = await client.recall({
        query,
        limit: maxMemories,
        min_similarity: minSimilarity,
        namespace,
        session_id: sessionId,
        agent_id: agentId,
        include_relations: includeRelations || undefined,
      });

      if (response.memories.length === 0) {
        return preamble ?? '';
      }

      const memoryLines = response.memories.map((m, i) =>
        `${i + 1}. [${(m.similarity * 100).toFixed(0)}% match] ${m.content}`
      );

      const memorySection = [
        '## Relevant Memories',
        '',
        ...memoryLines,
      ].join('\n');

      return preamble
        ? `${preamble}\n\n${memorySection}`
        : memorySection;
    },

    async recall(query: string): Promise<RecallMemory[]> {
      const response = await client.recall({
        query,
        limit: maxMemories,
        min_similarity: minSimilarity,
        namespace,
        session_id: sessionId,
        agent_id: agentId,
        include_relations: includeRelations || undefined,
      });
      return response.memories;
    },

    async storeMessage(role: string, content: string, importance?: number): Promise<string> {
      const request: StoreRequest = {
        content,
        metadata: { tags: ['conversation'], role },
        session_id: sessionId,
        namespace,
        agent_id: agentId,
        importance,
      };
      const result = await client.store(request);
      return result.id;
    },

    async store(content: string, storeOptions?: Partial<StoreRequest>): Promise<string> {
      const request: StoreRequest = {
        content,
        namespace,
        session_id: sessionId,
        agent_id: agentId,
        ...storeOptions,
      };
      const result = await client.store(request);
      return result.id;
    },
  };
}

// ── Tool Definition Types ───────────────────────────────────────────────────
// Minimal type definitions for Vercel AI SDK tool compatibility
// without requiring `ai` or `zod` as build-time dependencies.

/** A tool definition compatible with Vercel AI SDK's tool interface. */
export interface MemoryToolDefinition {
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description?: string;
      minimum?: number;
      maximum?: number;
      items?: { type: string };
    }>;
    required: string[];
  };
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface MemoryToolsOptions {
  /** Optional MemoClaw namespace. */
  namespace?: string;
  /** Optional session ID. */
  sessionId?: string;
  /** Optional agent ID. */
  agentId?: string;
}

/**
 * Create tool definitions for MemoClaw that work with Vercel AI SDK.
 *
 * Returns an object with `store_memory` and `recall_memories` tools
 * with JSON Schema parameters (compatible with `generateText`/`streamText`).
 *
 * For native Vercel AI SDK `tool()` integration with Zod schemas,
 * you can wrap these yourself or use the JSON Schema definitions directly.
 */
export function createMemoryTools(
  client: MemoClawClient,
  options: MemoryToolsOptions = {},
): Record<string, MemoryToolDefinition> {
  const { namespace, sessionId, agentId } = options;

  return {
    store_memory: {
      description: 'Store a piece of information as a persistent memory for later recall.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The content to store as a memory' },
          importance: { type: 'number', description: 'Importance score from 0.0 to 1.0', minimum: 0, maximum: 1 },
          tags: { type: 'array', description: 'Tags for categorizing the memory', items: { type: 'string' } },
        },
        required: ['content'],
      },
      execute: async (args: Record<string, unknown>) => {
        const content = args['content'] as string;
        const importance = args['importance'] as number | undefined;
        const tags = args['tags'] as string[] | undefined;
        const request: StoreRequest = {
          content,
          importance,
          namespace,
          session_id: sessionId,
          agent_id: agentId,
        };
        if (tags?.length) {
          request.metadata = { tags };
        }
        const result = await client.store(request);
        return { id: result.id, stored: result.stored };
      },
    },

    recall_memories: {
      description: 'Search for relevant memories using semantic similarity.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query to find relevant memories' },
          limit: { type: 'number', description: 'Maximum number of results (default: 5)', minimum: 1, maximum: 50 },
        },
        required: ['query'],
      },
      execute: async (args: Record<string, unknown>) => {
        const query = args['query'] as string;
        const limit = (args['limit'] as number | undefined) ?? 5;
        const response = await client.recall({
          query,
          limit,
          namespace,
          session_id: sessionId,
          agent_id: agentId,
        });
        return response.memories.map((m) => ({
          content: m.content,
          similarity: m.similarity,
          importance: m.importance,
          created_at: m.created_at,
        }));
      },
    },
  };
}
