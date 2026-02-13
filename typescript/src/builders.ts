/**
 * Builder patterns for fluent API usage in MemoClaw SDK.
 * 
 * Provides chainable builders for complex queries and memory operations.
 * 
 * @example
 * ```ts
 * import { MemoClawClient, RecallQuery, MemoryFilter } from '@memoclaw/sdk';
 * 
 * const client = new MemoClawClient({ wallet: '0x...' });
 * 
 * // Build a complex recall query
 * const results = await new RecallQuery(client)
 *   .withQuery('user preferences for dark mode')
 *   .withLimit(10)
 *   .withMinSimilarity(0.7)
 *   .withNamespace('user-prefs')
 *   .withTags(['preferences', 'ui'])
 *   .includeRelations()
 *   .execute();
 * ```
 */

import type { MemoClawClient } from './client.js';
import type {
  RecallRequest,
  RecallResponse,
  ListMemoriesParams,
  Memory,
  RelationType,
  StoreRequest,
  StoreBatchResponse,
  MemoryType,
} from './types.js';

/**
 * Fluent builder for constructing recall queries.
 */
export class RecallQuery {
  private _query = '';
  private _limit?: number;
  private _minSimilarity?: number;
  private _namespace?: string;
  private _tags?: string[];
  private _sessionId?: string;
  private _agentId?: string;
  private _includeRelations?: boolean;
  private _after?: string;
  private _memoryType?: MemoryType;

  constructor(private client: MemoClawClient) {}

  /** Set the search query. */
  withQuery(query: string): RecallQuery {
    this._query = query;
    return this;
  }

  /** Set the maximum number of results. */
  withLimit(limit: number): RecallQuery {
    this._limit = limit;
    return this;
  }

  /** Set minimum similarity threshold (0.0 to 1.0). */
  withMinSimilarity(minSimilarity: number): RecallQuery {
    if (minSimilarity < 0 || minSimilarity > 1) {
      throw new Error('minSimilarity must be between 0.0 and 1.0');
    }
    this._minSimilarity = minSimilarity;
    return this;
  }

  /** Filter by namespace. */
  withNamespace(namespace: string): RecallQuery {
    this._namespace = namespace;
    return this;
  }

  /** Filter by tags (AND logic). */
  withTags(tags: string[]): RecallQuery {
    this._tags = tags;
    return this;
  }

  /** Filter by session ID. */
  withSessionId(sessionId: string): RecallQuery {
    this._sessionId = sessionId;
    return this;
  }

  /** Filter by agent ID. */
  withAgentId(agentId: string): RecallQuery {
    this._agentId = agentId;
    return this;
  }

  /** Filter by memory type. */
  withMemoryType(memoryType: MemoryType): RecallQuery {
    this._memoryType = memoryType;
    return this;
  }

  /** Filter memories created after this ISO timestamp. */
  withAfter(after: string): RecallQuery {
    this._after = after;
    return this;
  }

  /** Include related memories in results. */
  includeRelations(include = true): RecallQuery {
    this._includeRelations = include;
    return this;
  }

  /** Execute the recall query. */
  async execute(): Promise<RecallResponse> {
    if (!this._query) {
      throw new Error('Query is required. Use .withQuery() to set it.');
    }
    return this.client.recall({
      query: this._query,
      limit: this._limit,
      min_similarity: this._minSimilarity,
      namespace: this._namespace,
      session_id: this._sessionId,
      agent_id: this._agentId,
      include_relations: this._includeRelations,
      filters: {
        tags: this._tags,
        after: this._after,
        memory_type: this._memoryType,
      },
    });
  }
}

/**
 * Fluent builder for filtering and iterating over memories.
 */
export class MemoryFilter {
  private _namespace?: string;
  private _tags?: string[];
  private _sessionId?: string;
  private _agentId?: string;
  private _batchSize = 50;

  constructor(private client: MemoClawClient) {}

  /** Filter by namespace. */
  withNamespace(namespace: string): MemoryFilter {
    this._namespace = namespace;
    return this;
  }

  /** Filter by tags. */
  withTags(tags: string[]): MemoryFilter {
    this._tags = tags;
    return this;
  }

  /** Filter by session ID. */
  withSessionId(sessionId: string): MemoryFilter {
    this._sessionId = sessionId;
    return this;
  }

  /** Filter by agent ID. */
  withAgentId(agentId: string): MemoryFilter {
    this._agentId = agentId;
    return this;
  }

  /** Set batch size for pagination. */
  withBatchSize(batchSize: number): MemoryFilter {
    if (batchSize <= 0) {
      throw new Error('batchSize must be positive');
    }
    this._batchSize = batchSize;
    return this;
  }

  /** Iterate over all matching memories. */
  async *iterMemories(): AsyncGenerator<Memory> {
    yield* this.client.iterMemories({
      namespace: this._namespace,
      tags: this._tags,
      session_id: this._sessionId,
      agent_id: this._agentId,
      batchSize: this._batchSize,
    });
  }

  /** Fetch all matching memories at once. */
  async listAll(): Promise<Memory[]> {
    const memories: Memory[] = [];
    for await (const memory of this.iterMemories()) {
      memories.push(memory);
    }
    return memories;
  }

  /** Count matching memories without fetching all data. */
  async count(): Promise<number> {
    const page = await this.client.list({
      limit: 1,
      namespace: this._namespace,
      tags: this._tags,
      session_id: this._sessionId,
      agent_id: this._agentId,
    });
    return page.total;
  }
}

/**
 * Fluent builder for creating and managing memory relations.
 */
export class RelationBuilder {
  private _relations: Array<{
    targetId: string;
    relationType: RelationType;
    metadata?: Record<string, unknown>;
  }> = [];

  constructor(
    private client: MemoClawClient,
    private sourceId: string
  ) {}

  /** Add a relation to be created. */
  relateTo(
    targetId: string,
    relationType: RelationType,
    metadata?: Record<string, unknown>
  ): RelationBuilder {
    this._relations.push({ targetId, relationType, metadata });
    return this;
  }

  /** Create all pending relations. */
  async createAll(): Promise<Array<{
    id: string;
    targetId: string;
    relationType: RelationType;
  }>> {
    const results = [];
    for (const { targetId, relationType, metadata } of this._relations) {
      const result = await this.client.createRelation(this.sourceId, {
        target_id: targetId,
        relation_type: relationType,
        metadata,
      });
      results.push({
        id: result.id,
        targetId,
        relationType,
      });
    }
    this._relations = [];
    return results;
  }
}

/**
 * Fluent builder for creating and managing memory relations (async version).
 */
export class AsyncRelationBuilder {
  private _relations: Array<{
    targetId: string;
    relationType: RelationType;
    metadata?: Record<string, unknown>;
  }> = [];

  constructor(
    private client: MemoClawClient,
    private sourceId: string
  ) {}

  /** Add a relation to be created. */
  relateTo(
    targetId: string,
    relationType: RelationType,
    metadata?: Record<string, unknown>
  ): AsyncRelationBuilder {
    this._relations.push({ targetId, relationType, metadata });
    return this;
  }

  /** Create all pending relations. */
  async createAll(): Promise<Array<{
    id: string;
    targetId: string;
    relationType: RelationType;
  }>> {
    const results = [];
    for (const { targetId, relationType, metadata } of this._relations) {
      const result = await this.client.createRelation(this.sourceId, {
        target_id: targetId,
        relation_type: relationType,
        metadata,
      });
      results.push({
        id: result.id,
        targetId,
        relationType,
      });
    }
    this._relations = [];
    return results;
  }
}

/**
 * Fluent builder for filtering and iterating over memories (async version).
 */
export class AsyncMemoryFilter {
  private _namespace?: string;
  private _tags?: string[];
  private _sessionId?: string;
  private _agentId?: string;
  private _batchSize = 50;

  constructor(private client: MemoClawClient) {}

  /** Filter by namespace. */
  withNamespace(namespace: string): AsyncMemoryFilter {
    this._namespace = namespace;
    return this;
  }

  /** Filter by tags. */
  withTags(tags: string[]): AsyncMemoryFilter {
    this._tags = tags;
    return this;
  }

  /** Filter by session ID. */
  withSessionId(sessionId: string): AsyncMemoryFilter {
    this._sessionId = sessionId;
    return this;
  }

  /** Filter by agent ID. */
  withAgentId(agentId: string): AsyncMemoryFilter {
    this._agentId = agentId;
    return this;
  }

  /** Set batch size for pagination. */
  withBatchSize(batchSize: number): AsyncMemoryFilter {
    if (batchSize <= 0) {
      throw new Error('batchSize must be positive');
    }
    this._batchSize = batchSize;
    return this;
  }

  /** Iterate over all matching memories. */
  async *iterMemories(): AsyncGenerator<Memory> {
    yield* this.client.iterMemories({
      namespace: this._namespace,
      tags: this._tags,
      session_id: this._sessionId,
      agent_id: this._agentId,
      batchSize: this._batchSize,
    });
  }

  /** Fetch all matching memories at once. */
  async listAll(): Promise<Memory[]> {
    const memories: Memory[] = [];
    for await (const memory of this.iterMemories()) {
      memories.push(memory);
    }
    return memories;
  }

  /** Count matching memories without fetching all data. */
  async count(): Promise<number> {
    const page = await this.client.list({
      limit: 1,
      namespace: this._namespace,
      tags: this._tags,
      session_id: this._sessionId,
      agent_id: this._agentId,
    });
    return page.total;
  }
}

/**
 * Efficient batch storage with automatic chunking.
 * Automatically handles chunking large batches into smaller API-friendly sizes.
 */
export class BatchStore {
  private static readonly MAX_BATCH_SIZE = 100;

  private _memories: StoreRequest[] = [];

  constructor(private client: MemoClawClient) {}

  /** Add a memory to the batch. */
  add(
    content: string,
    options?: {
      importance?: number;
      tags?: string[];
      namespace?: string;
      memoryType?: MemoryType;
      sessionId?: string;
      agentId?: string;
      metadata?: Record<string, unknown>;
    }
  ): BatchStore {
    const memory: StoreRequest = { content };
    if (options?.importance !== undefined) memory.importance = options.importance;
    if (options?.tags) memory.metadata = { ...memory.metadata, tags: options.tags };
    if (options?.namespace) memory.namespace = options.namespace;
    if (options?.memoryType) memory.memory_type = options.memoryType;
    if (options?.sessionId) memory.session_id = options.sessionId;
    if (options?.agentId) memory.agent_id = options.agentId;
    if (options?.metadata) memory.metadata = { ...memory.metadata, ...options.metadata };
    this._memories.push(memory);
    return this;
  }

  /** Add multiple memories at once. */
  addMany(memories: StoreRequest[]): BatchStore {
    this._memories.push(...memories);
    return this;
  }

  /** Return the number of memories in the batch. */
  count(): number {
    return this._memories.length;
  }

  /** Execute batch storage, handling automatic chunking. */
  async execute(): Promise<{
    ids: string[];
    count: number;
    stored: boolean;
    tokensUsed: number;
    deduplicatedCount: number;
  }> {
    if (this._memories.length === 0) {
      return { ids: [], count: 0, stored: false, tokensUsed: 0, deduplicatedCount: 0 };
    }

    const allIds: string[] = [];
    let totalTokens = 0;
    let totalDeduped = 0;

    // Process in chunks
    for (let i = 0; i < this._memories.length; i += BatchStore.MAX_BATCH_SIZE) {
      const chunk = this._memories.slice(i, i + BatchStore.MAX_BATCH_SIZE);
      const result = await this.client.storeBatch(chunk);
      allIds.push(...result.ids);
      totalTokens += result.tokens_used;
      totalDeduped += result.deduplicated_count;
    }

    this._memories = [];

    return {
      ids: allIds,
      count: allIds.length,
      stored: true,
      tokensUsed: totalTokens,
      deduplicatedCount: totalDeduped,
    };
  }
}

/**
 * Streaming response handler for real-time memory processing.
 * Provides an async iterable interface for processing memories as they arrive.
 */
export class StreamingRecall {
  constructor(private client: MemoClawClient) {}

  /**
   * Stream recall results as an async generator.
   * Useful for processing large result sets incrementally.
   */
  async *stream(
    request: RecallRequest
  ): AsyncGenerator<RecallResponse['memories'][0], void, unknown> {
    const response = await this.client.recall(request);
    for (const memory of response.memories) {
      yield memory;
    }
  }
}
