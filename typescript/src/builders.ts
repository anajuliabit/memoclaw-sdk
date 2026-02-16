/**
 * Fluent builder patterns for TypeScript SDK.
 * 
 * @example
 * ```ts
 * import { MemoryBuilder, RecallBuilder } from '@memoclaw/sdk';
 * 
 * // Build a memory
 * const memory = new MemoryBuilder()
 *   .content('User prefers dark mode')
 *   .importance(0.9)
 *   .tags(['preferences', 'ui'])
 *   .namespace('app-settings')
 *   .memoryType('preference')
 *   .pinned(true)
 *   .build();
 * 
 * await client.store(memory);
 * 
 * // Build recall params
 * const params = new RecallBuilder()
 *   .query('user interface preferences')
 *   .limit(10)
 *   .minSimilarity(0.7)
 *   .namespace('app-settings')
 *   .includeRelations(true)
 *   .build();
 * 
 * const results = await client.recall(params);
 * ```
 */

import type { StoreRequest, RecallRequest, MemoryType, RelationType, RecallResponse, ListMemoriesParams, Memory, StoreBatchResponse, StoreResponse } from './types.js';
import type { MemoClawClient } from './client.js';

/**
 * Fluent builder for creating memory content.
 */
export class MemoryBuilder {
  private _content?: string;
  private _importance?: number;
  private _tags?: string[];
  private _namespace?: string;
  private _memoryType?: MemoryType;
  private _sessionId?: string;
  private _agentId?: string;
  private _expiresAt?: string;
  private _pinned?: boolean;
  private _metadata?: Record<string, unknown>;

  /**
   * Set the memory content (required).
   */
  content(content: string): this {
    this._content = content;
    return this;
  }

  /**
   * Set importance (0.0 to 1.0).
   */
  importance(importance: number): this {
    if (importance < 0 || importance > 1) {
      throw new Error('importance must be between 0.0 and 1.0');
    }
    this._importance = importance;
    return this;
  }

  /**
   * Set tags for the memory.
   */
  tags(tags: string[]): this {
    this._tags = tags;
    return this;
  }

  /**
   * Add a single tag.
   */
  addTag(tag: string): this {
    if (!this._tags) this._tags = [];
    this._tags.push(tag);
    return this;
  }

  /**
   * Set namespace.
   */
  namespace(namespace: string): this {
    this._namespace = namespace;
    return this;
  }

  /**
   * Set memory type.
   */
  memoryType(memoryType: MemoryType): this {
    this._memoryType = memoryType;
    return this;
  }

  /**
   * Set session ID.
   */
  session(sessionId: string): this {
    this._sessionId = sessionId;
    return this;
  }

  /**
   * Set agent ID.
   */
  agent(agentId: string): this {
    this._agentId = agentId;
    return this;
  }

  /**
   * Set expiration timestamp (ISO 8601 format).
   */
  expiresAt(expiresAt: string): this {
    this._expiresAt = expiresAt;
    return this;
  }

  /**
   * Set expiration relative to now (in days).
   */
  expiresInDays(days: number): this {
    const date = new Date();
    date.setDate(date.getDate() + days);
    this._expiresAt = date.toISOString();
    return this;
  }

  /**
   * Set pinned status.
   */
  pinned(pinned: boolean = true): this {
    this._pinned = pinned;
    return this;
  }

  /**
   * Set custom metadata.
   */
  metadata(metadata: Record<string, unknown>): this {
    this._metadata = metadata;
    return this;
  }

  /**
   * Add a single metadata key-value pair.
   */
  addMetadata(key: string, value: unknown): this {
    if (!this._metadata) this._metadata = {};
    this._metadata[key] = value;
    return this;
  }

  /**
   * Build the StoreRequest object.
   */
  build(): StoreRequest {
    if (!this._content) {
      throw new Error('content is required');
    }
    const metadata: Record<string, unknown> = this._metadata ? { ...this._metadata } : {};
    if (this._tags) metadata.tags = this._tags;
    return {
      content: this._content,
      importance: this._importance,
      namespace: this._namespace,
      memory_type: this._memoryType,
      session_id: this._sessionId,
      agent_id: this._agentId,
      expires_at: this._expiresAt,
      pinned: this._pinned,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    };
  }
}

/**
 * Fluent builder for recall queries.
 */
export class RecallBuilder {
  private _query?: string;
  private _limit?: number;
  private _minSimilarity?: number;
  private _namespace?: string;
  private _tags?: string[];
  private _sessionId?: string;
  private _agentId?: string;
  private _includeRelations?: boolean;
  private _memoryType?: MemoryType;
  private _after?: string;

  /**
   * Set the search query (required).
   */
  query(query: string): this {
    this._query = query;
    return this;
  }

  /**
   * Set maximum results.
   */
  limit(limit: number): this {
    this._limit = limit;
    return this;
  }

  /**
   * Set minimum similarity threshold (0.0 to 1.0).
   */
  minSimilarity(minSimilarity: number): this {
    if (minSimilarity < 0 || minSimilarity > 1) {
      throw new Error('minSimilarity must be between 0.0 and 1.0');
    }
    this._minSimilarity = minSimilarity;
    return this;
  }

  /**
   * Filter by namespace.
   */
  namespace(namespace: string): this {
    this._namespace = namespace;
    return this;
  }

  /**
   * Filter by tags.
   */
  tags(tags: string[]): this {
    this._tags = tags;
    return this;
  }

  /**
   * Filter by session.
   */
  session(sessionId: string): this {
    this._sessionId = sessionId;
    return this;
  }

  /**
   * Filter by agent.
   */
  agent(agentId: string): this {
    this._agentId = agentId;
    return this;
  }

  /**
   * Include related memories in results.
   */
  includeRelations(include: boolean = true): this {
    this._includeRelations = include;
    return this;
  }

  /**
   * Filter by memory type.
   */
  memoryType(memoryType: MemoryType): this {
    this._memoryType = memoryType;
    return this;
  }

  /**
   * Filter memories created after this ISO timestamp.
   */
  after(after: string): this {
    this._after = after;
    return this;
  }

  /**
   * Build the RecallRequest object.
   */
  build(): RecallRequest {
    if (!this._query) {
      throw new Error('query is required');
    }

    const request: RecallRequest = { query: this._query };

    if (this._limit !== undefined) request.limit = this._limit;
    if (this._minSimilarity !== undefined) request.min_similarity = this._minSimilarity;
    if (this._namespace) request.namespace = this._namespace;
    if (this._sessionId) request.session_id = this._sessionId;
    if (this._agentId) request.agent_id = this._agentId;
    if (this._includeRelations !== undefined) request.include_relations = this._includeRelations;

    if (this._tags !== undefined || this._memoryType !== undefined || this._after !== undefined) {
      request.filters = {};
      if (this._tags) request.filters.tags = this._tags;
      if (this._memoryType) request.filters.memory_type = this._memoryType;
      if (this._after) request.filters.after = this._after;
    }

    return request;
  }
}

// ── Additional builder classes ──

/**
 * Async version of RecallQuery for use with async operations.
 * Provides the same fluent interface but returns promises.
 */
export class AsyncRecallQuery {
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
  withQuery(query: string): AsyncRecallQuery {
    this._query = query;
    return this;
  }

  /** Set the maximum number of results. */
  withLimit(limit: number): AsyncRecallQuery {
    this._limit = limit;
    return this;
  }

  /** Set minimum similarity threshold (0.0 to 1.0). */
  withMinSimilarity(minSimilarity: number): AsyncRecallQuery {
    if (minSimilarity < 0 || minSimilarity > 1) {
      throw new Error('minSimilarity must be between 0.0 and 1.0');
    }
    this._minSimilarity = minSimilarity;
    return this;
  }

  /** Filter by namespace. */
  withNamespace(namespace: string): AsyncRecallQuery {
    this._namespace = namespace;
    return this;
  }

  /** Filter by tags (AND logic). */
  withTags(tags: string[]): AsyncRecallQuery {
    this._tags = tags;
    return this;
  }

  /** Filter by session ID. */
  withSessionId(sessionId: string): AsyncRecallQuery {
    this._sessionId = sessionId;
    return this;
  }

  /** Filter by agent ID. */
  withAgentId(agentId: string): AsyncRecallQuery {
    this._agentId = agentId;
    return this;
  }

  /** Filter by memory type. */
  withMemoryType(memoryType: MemoryType): AsyncRecallQuery {
    this._memoryType = memoryType;
    return this;
  }

  /** Filter memories created after this ISO timestamp. */
  withAfter(after: string): AsyncRecallQuery {
    this._after = after;
    return this;
  }

  /** Include related memories in results. */
  includeRelations(include = true): AsyncRecallQuery {
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

  /** Execute and iterate over results as an async generator. */
  async *executeIter(): AsyncGenerator<RecallResponse['memories'][0]> {
    const response = await this.execute();
    for (const memory of response.memories) {
      yield memory;
    }
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

/** @deprecated Use RelationBuilder directly (all TS client methods are async). */
export const AsyncRelationBuilder = RelationBuilder;

/** @deprecated Use MemoryFilter directly (all TS client methods are async). */
export const AsyncMemoryFilter = MemoryFilter;

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

/**
 * Fluent builder for creating memories before storing.
 * Provides a chainable API for constructing memory objects.
 * 
 * @example
 * ```ts
 * import { MemoClawClient, StoreBuilder } from '@memoclaw/sdk';
 * 
 * const client = new MemoClawClient({ wallet: '0x...' });
 * const result = await new StoreBuilder(client)
 *   .content('User prefers dark mode')
 *   .importance(0.9)
 *   .tags(['preferences', 'ui'])
 *   .namespace('user-prefs')
 *   .memoryType('preference')
 *   .execute();
 * ```
 */
export class StoreBuilder {
  private _content?: string;
  private _importance?: number;
  private _tags?: string[];
  private _namespace?: string;
  private _memoryType?: MemoryType;
  private _sessionId?: string;
  private _agentId?: string;
  private _expiresAt?: string;
  private _pinned?: boolean;
  private _metadata?: Record<string, unknown>;

  constructor(private client: MemoClawClient) {}

  /** Set the memory content. */
  content(content: string): StoreBuilder {
    this._content = content;
    return this;
  }

  /** Set importance (0.0 to 1.0). */
  importance(importance: number): StoreBuilder {
    if (importance < 0 || importance > 1) {
      throw new Error('importance must be between 0.0 and 1.0');
    }
    this._importance = importance;
    return this;
  }

  /** Set tags for the memory. */
  tags(tags: string[]): StoreBuilder {
    this._tags = tags;
    return this;
  }

  /** Add a single tag. */
  addTag(tag: string): StoreBuilder {
    if (!this._tags) {
      this._tags = [];
    }
    this._tags.push(tag);
    return this;
  }

  /** Set namespace. */
  namespace(namespace: string): StoreBuilder {
    this._namespace = namespace;
    return this;
  }

  /** Set memory type. */
  memoryType(memoryType: MemoryType): StoreBuilder {
    this._memoryType = memoryType;
    return this;
  }

  /** Set session ID. */
  sessionId(sessionId: string): StoreBuilder {
    this._sessionId = sessionId;
    return this;
  }

  /** Set agent ID. */
  agentId(agentId: string): StoreBuilder {
    this._agentId = agentId;
    return this;
  }

  /** Set expiration timestamp (ISO format). */
  expiresAt(expiresAt: string): StoreBuilder {
    this._expiresAt = expiresAt;
    return this;
  }

  /** Pin the memory. */
  pinned(pinned = true): StoreBuilder {
    this._pinned = pinned;
    return this;
  }

  /** Set custom metadata. */
  metadata(metadata: Record<string, unknown>): StoreBuilder {
    this._metadata = metadata;
    return this;
  }

  /** Execute the store operation. */
  async execute(): Promise<StoreResponse> {
    if (!this._content) {
      throw new Error("Content is required. Use .content() to set it.");
    }
    const request: StoreRequest = { content: this._content };
    if (this._importance !== undefined) request.importance = this._importance;
    if (this._tags) request.metadata = { ...request.metadata, tags: this._tags };
    if (this._namespace) request.namespace = this._namespace;
    if (this._memoryType) request.memory_type = this._memoryType;
    if (this._sessionId) request.session_id = this._sessionId;
    if (this._agentId) request.agent_id = this._agentId;
    if (this._expiresAt) request.expires_at = this._expiresAt;
    if (this._pinned !== undefined) request.pinned = this._pinned;
    if (this._metadata) request.metadata = { ...request.metadata, ...this._metadata };
    return this.client.store(request);
  }
}

/** @deprecated Use StoreBuilder directly (all TS client methods are async). */
export const AsyncStoreBuilder = StoreBuilder;

/** Alias for AsyncRecallQuery (all TS client methods are async). */
export const RecallQuery = AsyncRecallQuery;
