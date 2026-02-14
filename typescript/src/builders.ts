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

import type { StoreRequest, RecallRequest, MemoryType, RelationType } from './types.js';

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

    if (this._tags !== undefined || this._memoryType !== undefined) {
      request.filters = {};
      if (this._tags) request.filters.tags = this._tags;
      if (this._memoryType) request.filters.memory_type = this._memoryType;
    }

    return request;
  }
}
