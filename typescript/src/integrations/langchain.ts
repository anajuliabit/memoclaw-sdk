/**
 * LangChain.js integration for MemoClaw.
 *
 * Provides:
 * - {@link MemoClawChatMessageHistory} — LangChain-compatible chat message history
 *   backed by MemoClaw's memory API.
 * - {@link MemoClawRetriever} — LangChain-compatible retriever that performs semantic
 *   recall over stored memories.
 *
 * Install peer dependencies:
 * ```bash
 * npm install @langchain/core
 * ```
 *
 * @example Chat history
 * ```typescript
 * import { MemoClawClient } from '@memoclaw/sdk';
 * import { MemoClawChatMessageHistory } from '@memoclaw/sdk/langchain';
 *
 * const client = await MemoClawClient.create({ privateKey: '0x...' });
 * const history = new MemoClawChatMessageHistory({ client, sessionId: 'chat-42' });
 * await history.addMessage(new HumanMessage('I prefer dark mode'));
 * const messages = await history.getMessages();
 * ```
 *
 * @example Retriever
 * ```typescript
 * import { MemoClawRetriever } from '@memoclaw/sdk/langchain';
 *
 * const retriever = new MemoClawRetriever({ client, namespace: 'project-x' });
 * const docs = await retriever.invoke('user preferences');
 * ```
 *
 * @module
 */

import type { MemoClawClient } from '../client.js';
import type { StoreRequest } from '../types.js';

// ── Types ───────────────────────────────────────────────────────────────────
// We use minimal interfaces instead of importing from @langchain/core
// so this module compiles without the peer dependency installed.

/** Minimal LangChain BaseMessage interface. */
export interface LangChainMessage {
  content: string | Array<{ type: string; text?: string }>;
  _getType(): string;
}

/** Minimal LangChain Document interface. */
export interface LangChainDocument {
  pageContent: string;
  metadata: Record<string, unknown>;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function messageToRole(message: LangChainMessage): string {
  const type = message._getType();
  if (type === 'human') return 'user';
  if (type === 'ai') return 'assistant';
  if (type === 'system') return 'system';
  return type;
}

function contentToString(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === 'string') return content;
  return content
    .filter((c) => c.type === 'text' && c.text)
    .map((c) => c.text!)
    .join('');
}

/** Create a LangChain-style message object (without requiring @langchain/core). */
function createMessage(role: string, content: string): LangChainMessage {
  return {
    content,
    _getType: () => (role === 'user' ? 'human' : role === 'assistant' ? 'ai' : role),
  };
}

/** Create a LangChain-style Document object (without requiring @langchain/core). */
function createDocument(pageContent: string, metadata: Record<string, unknown>): LangChainDocument {
  return { pageContent, metadata };
}

// ── Chat Message History ────────────────────────────────────────────────────

export interface MemoClawChatMessageHistoryOptions {
  /** Configured MemoClawClient instance. */
  client: MemoClawClient;
  /** Unique session identifier. Maps to MemoClaw's session_id parameter. */
  sessionId: string;
  /** Optional MemoClaw namespace for isolation. */
  namespace?: string;
  /** Optional agent identifier. */
  agentId?: string;
  /** Tag used to identify chat messages (default: "chat_message"). */
  tag?: string;
}

/**
 * LangChain-compatible chat message history backed by MemoClaw.
 *
 * Stores each message as an individual memory with a configurable tag.
 * Messages are stored via `client.store()` and retrieved via `client.list()`.
 *
 * Implements the same interface as LangChain's `BaseChatMessageHistory`
 * via duck-typing, so it works with LangChain APIs without requiring
 * `@langchain/core` at build time.
 */
export class MemoClawChatMessageHistory {
  private readonly _client: MemoClawClient;
  private readonly _sessionId: string;
  private readonly _namespace?: string;
  private readonly _agentId?: string;
  private readonly _tag: string;

  constructor(options: MemoClawChatMessageHistoryOptions) {
    this._client = options.client;
    this._sessionId = options.sessionId;
    this._namespace = options.namespace;
    this._agentId = options.agentId;
    this._tag = options.tag ?? 'chat_message';
  }

  /** Retrieve all messages for this session from MemoClaw. */
  async getMessages(): Promise<LangChainMessage[]> {
    const result: LangChainMessage[] = [];
    let offset = 0;
    const batchSize = 100;

    while (true) {
      const page = await this._client.list({
        session_id: this._sessionId,
        namespace: this._namespace,
        agent_id: this._agentId,
        tags: [this._tag],
        limit: batchSize,
        offset,
      });

      for (const memory of page.memories) {
        const meta = memory.metadata ?? {};
        const role = String(meta['role'] ?? 'user');
        result.push(createMessage(role, memory.content));
      }

      offset += page.memories.length;
      if (offset >= page.total || page.memories.length === 0) break;
    }

    return result;
  }

  /** Store a single message in MemoClaw. */
  async addMessage(message: LangChainMessage): Promise<void> {
    const role = messageToRole(message);
    const content = contentToString(message.content);
    const request: StoreRequest = {
      content,
      metadata: { tags: [this._tag], role },
      session_id: this._sessionId,
    };
    if (this._namespace) request.namespace = this._namespace;
    if (this._agentId) request.agent_id = this._agentId;
    await this._client.store(request);
  }

  /** Store multiple messages in MemoClaw using batch storage. */
  async addMessages(messages: LangChainMessage[]): Promise<void> {
    if (messages.length === 0) return;

    const items: StoreRequest[] = messages.map((message) => {
      const role = messageToRole(message);
      const content = contentToString(message.content);
      const req: StoreRequest = {
        content,
        metadata: { tags: [this._tag], role },
        session_id: this._sessionId,
      };
      if (this._namespace) req.namespace = this._namespace;
      if (this._agentId) req.agent_id = this._agentId;
      return req;
    });

    // Batch in chunks of 100
    for (let i = 0; i < items.length; i += 100) {
      const chunk = items.slice(i, i + 100);
      await this._client.storeBatch(chunk);
    }
  }

  /** Delete all messages for this session from MemoClaw. */
  async clear(): Promise<void> {
    const ids: string[] = [];
    let offset = 0;
    const batchSize = 100;

    while (true) {
      const page = await this._client.list({
        session_id: this._sessionId,
        namespace: this._namespace,
        agent_id: this._agentId,
        tags: [this._tag],
        limit: batchSize,
        offset,
      });

      ids.push(...page.memories.map((m) => m.id));
      offset += page.memories.length;
      if (offset >= page.total || page.memories.length === 0) break;
    }

    if (ids.length > 0) {
      await this._client.deleteBatch(ids);
    }
  }
}

// ── Retriever ───────────────────────────────────────────────────────────────

export interface MemoClawRetrieverOptions {
  /** Configured MemoClawClient instance. */
  client: MemoClawClient;
  /** Optional MemoClaw namespace filter. */
  namespace?: string;
  /** Optional tag filter for recall. */
  tags?: string[];
  /** Maximum number of memories to return (default: 5). */
  topK?: number;
  /** Minimum similarity threshold (0.0–1.0). */
  minSimilarity?: number;
  /** Optional session ID filter. */
  sessionId?: string;
  /** Optional agent ID filter. */
  agentId?: string;
  /** Whether to include related memories. */
  includeRelations?: boolean;
}

/**
 * LangChain-compatible retriever that performs semantic recall over MemoClaw memories.
 *
 * Each recalled memory is returned as a LangChain-compatible Document with the memory
 * content as `pageContent` and memory metadata in `metadata`.
 */
export class MemoClawRetriever {
  private readonly _client: MemoClawClient;
  private readonly _namespace?: string;
  private readonly _tags?: string[];
  private readonly _topK: number;
  private readonly _minSimilarity?: number;
  private readonly _sessionId?: string;
  private readonly _agentId?: string;
  private readonly _includeRelations: boolean;

  constructor(options: MemoClawRetrieverOptions) {
    this._client = options.client;
    this._namespace = options.namespace;
    this._tags = options.tags;
    this._topK = options.topK ?? 5;
    this._minSimilarity = options.minSimilarity;
    this._sessionId = options.sessionId;
    this._agentId = options.agentId;
    this._includeRelations = options.includeRelations ?? false;
  }

  /**
   * Retrieve relevant documents from MemoClaw via semantic recall.
   * Compatible with LangChain's retriever interface.
   */
  async invoke(query: string): Promise<LangChainDocument[]> {
    const response = await this._client.recall({
      query,
      limit: this._topK,
      namespace: this._namespace,
      min_similarity: this._minSimilarity,
      session_id: this._sessionId,
      agent_id: this._agentId,
      include_relations: this._includeRelations || undefined,
      filters: this._tags ? { tags: this._tags } : undefined,
    });

    return response.memories.map((memory) => {
      const metadata: Record<string, unknown> = {
        id: memory.id,
        similarity: memory.similarity,
        importance: memory.importance,
        memory_type: memory.memory_type,
        namespace: memory.namespace,
        created_at: memory.created_at,
      };
      if (memory.metadata) {
        metadata['memory_metadata'] = memory.metadata;
      }
      if (memory.session_id) {
        metadata['session_id'] = memory.session_id;
      }
      if (memory.agent_id) {
        metadata['agent_id'] = memory.agent_id;
      }

      return createDocument(memory.content, metadata);
    });
  }

  /** Alias for invoke() — matches LangChain's getRelevantDocuments pattern. */
  async getRelevantDocuments(query: string): Promise<LangChainDocument[]> {
    return this.invoke(query);
  }
}
