import type {
  MemoClawOptions,
  MemoClawErrorBody,
  RelationType,
  StoreRequest,
  StoreResponse,
  StoreBatchRequest,
  StoreBatchResponse,
  RecallRequest,
  RecallResponse,
  Memory,
  ListMemoriesResponse,
  ListMemoriesParams,
  UpdateMemoryRequest,
  DeleteResponse,
  IngestRequest,
  IngestResponse,
  SuggestedParams,
  SuggestedResponse,
  ExtractRequest,
  ExtractResponse,
  ConsolidateRequest,
  ConsolidateResponse,
  CreateRelationRequest,
  CreateRelationResponse,
  ListRelationsResponse,
  DeleteRelationResponse,
  FreeTierStatus,
  MigrateFile,
  MigrateRequest,
  MigrateResponse,
  ContextRequest,
  ContextResponse,
  NamespacesResponse,
  StatsResponse,
  ExportParams,
  ExportResponse,
  HistoryEntry,
  HistoryResponse,
  UpdateBatchItem,
  UpdateBatchRequest,
  UpdateBatchResponse,
  CoreMemoriesParams,
  CoreMemoriesResponse,
  TextSearchParams,
  TextSearchResponse,
} from './types.js';
import {
  MemoClawError,
  AuthenticationError,
  PaymentRequiredError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  RateLimitError,
  InternalServerError,
  createError,
} from './errors.js';
import { loadConfig } from './config.js';
import { StoreBuilder } from './builders.js';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import type { Hex } from 'viem';

const DEFAULT_BASE_URL = 'https://api.memoclaw.com';
const MAX_BATCH_SIZE = 100;

/** Status codes that are safe to retry (transient errors). */
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

/** Hook called before each request. Can modify the body. */
export type BeforeRequestHook = (method: string, path: string, body?: unknown) => unknown | void;
/** Hook called after each successful response. */
export type AfterResponseHook = (method: string, path: string, data: unknown) => unknown | void;
/** Hook called on error. */
export type OnErrorHook = (method: string, path: string, error: MemoClawError) => void;

/**
 * Official TypeScript client for the MemoClaw memory API.
 *
 * @example
 * ```ts
 * import { MemoClawClient } from '@memoclaw/sdk';
 *
 * const client = new MemoClawClient({ wallet: '0x...' });
 * await client.store({ content: 'My first memory' });
 * const results = await client.recall({ query: 'first' });
 * ```
 */
export class MemoClawClient {
  private readonly baseUrl: string;
  private readonly wallet: string;
  private readonly _account: PrivateKeyAccount | null;
  private readonly _fetch: typeof globalThis.fetch;
  private readonly maxRetries: number;
  private readonly retryDelay: number;
  private readonly timeout: number;
  private readonly _beforeRequestHooks: BeforeRequestHook[] = [];
  private readonly _afterResponseHooks: AfterResponseHook[] = [];
  private readonly _onErrorHooks: OnErrorHook[] = [];

  constructor(options: MemoClawOptions = {}) {
    const config = loadConfig(options.configPath);

    // Only resolve private key from env/config if not explicitly providing wallet-only auth
    const privateKey = options.privateKey
      ?? (options.wallet ? undefined : (process.env.MEMOCLAW_PRIVATE_KEY ?? config.privateKey));

    if (privateKey) {
      const hex = (privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`) as Hex;
      this._account = privateKeyToAccount(hex);
    } else {
      this._account = null;
    }

    const wallet = options.wallet
      ?? (this._account?.address)
      ?? process.env.MEMOCLAW_WALLET
      ?? config.wallet;
    if (!wallet) {
      throw new Error(
        'wallet is required. Pass wallet option, set MEMOCLAW_WALLET, '
        + 'or run `memoclaw init` to create ~/.memoclaw/config.json.',
      );
    }

    const baseUrl = options.baseUrl
      ?? process.env.MEMOCLAW_URL
      ?? config.url
      ?? DEFAULT_BASE_URL;

    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.wallet = wallet;
    this._fetch = options.fetch ?? globalThis.fetch;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryDelay = options.retryDelay ?? 500;
    this.timeout = options.timeout ?? 0;
  }

  /** Register a hook called before each request. Returns this for chaining. */
  onBeforeRequest(hook: BeforeRequestHook): this {
    this._beforeRequestHooks.push(hook);
    return this;
  }

  /** Register a hook called after each successful response. Returns this for chaining. */
  onAfterResponse(hook: AfterResponseHook): this {
    this._afterResponseHooks.push(hook);
    return this;
  }

  /** Register a hook called on errors. Returns this for chaining. */
  onError(hook: OnErrorHook): this {
    this._onErrorHooks.push(hook);
    return this;
  }

  // ── Internal helpers ───────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<T> {
    let url = `${this.baseUrl}${path}`;
    if (query) {
      const params = new URLSearchParams(query);
      url += `?${params.toString()}`;
    }

    // Run before-request hooks
    let processedBody = body;
    for (const hook of this._beforeRequestHooks) {
      const result = hook(method, path, processedBody);
      if (result !== undefined) processedBody = result;
    }

    // Use signed wallet auth header if private key is provided, otherwise plain wallet address
    let walletHeader: string;
    if (this._account) {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const message = `memoclaw-auth:${timestamp}`;
      const signature = await this._account.signMessage({ message });
      walletHeader = `${this._account.address}:${timestamp}:${signature}`;
    } else {
      walletHeader = this.wallet;
    }
    const headers: Record<string, string> = { 'X-Wallet': walletHeader };
    if (processedBody !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const jsonBody = processedBody !== undefined ? JSON.stringify(processedBody) : undefined;

    // Combine caller signal with client-level timeout
    let combinedSignal = signal;
    if (this.timeout > 0) {
      const timeoutSignal = AbortSignal.timeout(this.timeout);
      combinedSignal = signal
        ? AbortSignal.any([signal, timeoutSignal])
        : timeoutSignal;
    }

    let lastError: MemoClawError | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let res: Response;
      try {
        res = await this._fetch(url, { method, headers, body: jsonBody, signal: combinedSignal });
      } catch (err) {
        if (err instanceof DOMException && (err.name === 'AbortError' || err.name === 'TimeoutError')) throw err;
        if (attempt < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, attempt);
          const jitter = delay * 0.25 * Math.random();
          await new Promise((resolve) => setTimeout(resolve, delay + jitter));
          continue;
        }
        throw err;
      }

      // On retryable status, honor Retry-After header if present
      if (!res.ok && RETRYABLE_STATUS_CODES.has(res.status) && attempt < this.maxRetries) {
        const retryAfter = res.headers.get('retry-after');
        let delay: number;
        if (retryAfter && /^\d+$/.test(retryAfter)) {
          delay = parseInt(retryAfter, 10) * 1000;
        } else {
          delay = this.retryDelay * Math.pow(2, attempt);
          const jitter = delay * 0.25 * Math.random();
          delay += jitter;
        }

        // Still need to consume the body for error context
        let errorBody: MemoClawErrorBody | undefined;
        try {
          errorBody = (await res.json()) as MemoClawErrorBody;
        } catch {
          // ignore parse failures
        }
        const code = errorBody?.error?.code ?? 'UNKNOWN_ERROR';
        const message = errorBody?.error?.message ?? `HTTP ${res.status}`;
        const details = errorBody?.error?.details;
        lastError = createError(res.status, code, message, details);

        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      if (res.ok) {
        let data = (await res.json()) as T;
        // Run after-response hooks
        for (const hook of this._afterResponseHooks) {
          const result = hook(method, path, data);
          if (result !== undefined) data = result as T;
        }
        return data;
      }

      let errorBody: MemoClawErrorBody | undefined;
      try {
        errorBody = (await res.json()) as MemoClawErrorBody;
      } catch {
        // ignore parse failures
      }

      const code = errorBody?.error?.code ?? 'UNKNOWN_ERROR';
      const message = errorBody?.error?.message ?? `HTTP ${res.status}`;
      const details = errorBody?.error?.details;

      lastError = createError(res.status, code, message, details);

      if (!RETRYABLE_STATUS_CODES.has(res.status)) {
        for (const hook of this._onErrorHooks) hook(method, path, lastError);
        throw lastError;
      }
    }

    if (lastError) {
      for (const hook of this._onErrorHooks) hook(method, path, lastError);
    }
    throw lastError!;
  }

  // ── Public API ─────────────────────────────────────

  /** Store a single memory. */
  async store(request: StoreRequest, options?: { signal?: AbortSignal }): Promise<StoreResponse> {
    if (!request.content?.trim()) {
      throw new Error('content must be a non-empty string');
    }
    return this.request<StoreResponse>('POST', '/v1/store', request, undefined, options?.signal);
  }

  /** Store multiple memories in a single request (up to 100). */
  async storeBatch(memories: StoreRequest[], options?: { signal?: AbortSignal }): Promise<StoreBatchResponse> {
    if (!memories.length) {
      throw new Error('memories array must not be empty');
    }
    if (memories.length > MAX_BATCH_SIZE) {
      throw new Error(`Batch size ${memories.length} exceeds maximum of ${MAX_BATCH_SIZE}`);
    }
    for (const m of memories) {
      if (!m.content?.trim()) {
        throw new Error('All memories must have non-empty content');
      }
    }
    return this.request<StoreBatchResponse>(
      'POST', '/v1/store/batch',
      { memories } satisfies StoreBatchRequest,
      undefined, options?.signal,
    );
  }

  /** Create a StoreBuilder for fluent memory creation. */
  storeBuilder(): StoreBuilder {
    return new StoreBuilder(this);
  }

  /** Recall memories via semantic search. */
  async recall(request: RecallRequest, options?: { signal?: AbortSignal }): Promise<RecallResponse> {
    if (!request.query?.trim()) {
      throw new Error('query must be a non-empty string');
    }
    return this.request<RecallResponse>('POST', '/v1/recall', request, undefined, options?.signal);
  }

  /** List memories with pagination and optional filters. */
  async list(params: ListMemoriesParams = {}, options?: { signal?: AbortSignal }): Promise<ListMemoriesResponse> {
    const query: Record<string, string> = {};
    if (params.limit !== undefined) query['limit'] = String(params.limit);
    if (params.offset !== undefined) query['offset'] = String(params.offset);
    if (params.tags?.length) query['tags'] = params.tags.join(',');
    if (params.namespace) query['namespace'] = params.namespace;
    if (params.session_id) query['session_id'] = params.session_id;
    if (params.agent_id) query['agent_id'] = params.agent_id;
    return this.request<ListMemoriesResponse>('GET', '/v1/memories', undefined, query, options?.signal);
  }

  /** Async iterator over all memories with automatic pagination. */
  async *iterMemories(params: Omit<ListMemoriesParams, 'offset'> & { batchSize?: number } = {}): AsyncGenerator<Memory, void, unknown> {
    const { batchSize = 50, ...rest } = params;
    let offset = 0;
    while (true) {
      const page = await this.list({ ...rest, limit: batchSize, offset });
      for (const mem of page.memories) {
        yield mem;
      }
      offset += page.memories.length;
      if (offset >= page.total || page.memories.length === 0) break;
    }
  }

  /** Retrieve a single memory by ID. */
  async get(id: string, options?: { signal?: AbortSignal }): Promise<Memory> {
    if (!id?.trim()) throw new Error('id must be a non-empty string');
    return this.request<Memory>('GET', `/v1/memories/${encodeURIComponent(id)}`, undefined, undefined, options?.signal);
  }

  /** Update a memory by ID. */
  async update(id: string, request: UpdateMemoryRequest, options?: { signal?: AbortSignal }): Promise<Memory> {
    if (!id?.trim()) throw new Error('id must be a non-empty string');
    return this.request<Memory>('PATCH', `/v1/memories/${encodeURIComponent(id)}`, request, undefined, options?.signal);
  }

  /** Update multiple memories in a single request (up to 100). */
  async updateBatch(updates: UpdateBatchItem[], options?: { signal?: AbortSignal }): Promise<UpdateBatchResponse> {
    if (!updates.length) {
      throw new Error('updates array must not be empty');
    }
    if (updates.length > MAX_BATCH_SIZE) {
      throw new Error(`Batch size ${updates.length} exceeds maximum of ${MAX_BATCH_SIZE}`);
    }
    for (const u of updates) {
      if (!u.id?.trim()) {
        throw new Error('All updates must have a non-empty id');
      }
    }
    return this.request<UpdateBatchResponse>(
      'POST', '/v1/memories/batch-update',
      { updates } satisfies UpdateBatchRequest,
      undefined, options?.signal,
    );
  }

  /** Delete a memory by ID (soft delete). */
  async delete(id: string, options?: { signal?: AbortSignal }): Promise<DeleteResponse> {
    if (!id?.trim()) throw new Error('id must be a non-empty string');
    return this.request<DeleteResponse>('DELETE', `/v1/memories/${encodeURIComponent(id)}`, undefined, undefined, options?.signal);
  }

  /** Delete multiple memories by ID in batch. */
  async deleteBatch(ids: string[], options?: { signal?: AbortSignal }): Promise<import('./types.js').DeleteBatchResult[]> {
    const results: import('./types.js').DeleteBatchResult[] = [];
    // Process in chunks of 50
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const response = await this.request<{ results: import('./types.js').DeleteBatchResult[] }>(
        'POST',
        '/v1/memories/batch-delete',
        { ids: chunk },
        undefined,
        options?.signal,
      );
      results.push(...response.results);
    }
    return results;
  }

  /** Alias for recall — matches Mem0/Pinecone "search" convention. */
  search(request: RecallRequest): Promise<RecallResponse> {
    return this.recall(request);
  }

  /** Ingest a conversation or text and auto-extract memories. */
  async ingest(request: IngestRequest, options?: { signal?: AbortSignal }): Promise<IngestResponse> {
    if (!request.messages?.length && !request.text?.trim()) {
      throw new Error('Either messages or text must be provided');
    }
    return this.request<IngestResponse>('POST', '/v1/ingest', request, undefined, options?.signal);
  }

  /** Check free tier remaining calls. */
  async status(options?: { signal?: AbortSignal }): Promise<FreeTierStatus> {
    return this.request<FreeTierStatus>('GET', '/v1/free-tier/status', undefined, undefined, options?.signal);
  }

  /** Extract structured facts from a conversation via LLM. */
  async extract(request: ExtractRequest, options?: { signal?: AbortSignal }): Promise<ExtractResponse> {
    if (!request.messages?.length) {
      throw new Error('messages must be a non-empty array');
    }
    return this.request<ExtractResponse>('POST', '/v1/memories/extract', request, undefined, options?.signal);
  }

  /** Merge similar memories by clustering. */
  async consolidate(request: ConsolidateRequest = {}, options?: { signal?: AbortSignal }): Promise<ConsolidateResponse> {
    return this.request<ConsolidateResponse>('POST', '/v1/memories/consolidate', request, undefined, options?.signal);
  }

  /** Create a relationship between two memories. */
  async createRelation(memoryId: string, request: CreateRelationRequest, options?: { signal?: AbortSignal }): Promise<CreateRelationResponse> {
    if (!memoryId?.trim()) throw new Error('memoryId must be a non-empty string');
    if (!request.target_id?.trim()) throw new Error('target_id must be a non-empty string');
    return this.request<CreateRelationResponse>(
      'POST', `/v1/memories/${encodeURIComponent(memoryId)}/relations`,
      request, undefined, options?.signal,
    );
  }

  /** List all relationships for a memory. */
  async listRelations(memoryId: string, options?: { signal?: AbortSignal }): Promise<ListRelationsResponse> {
    if (!memoryId?.trim()) throw new Error('memoryId must be a non-empty string');
    return this.request<ListRelationsResponse>(
      'GET', `/v1/memories/${encodeURIComponent(memoryId)}/relations`,
      undefined, undefined, options?.signal,
    );
  }

  /** Delete a relationship. */
  async deleteRelation(memoryId: string, relationId: string, options?: { signal?: AbortSignal }): Promise<DeleteRelationResponse> {
    if (!memoryId?.trim()) throw new Error('memoryId must be a non-empty string');
    if (!relationId?.trim()) throw new Error('relationId must be a non-empty string');
    return this.request<DeleteRelationResponse>(
      'DELETE', `/v1/memories/${encodeURIComponent(memoryId)}/relations/${encodeURIComponent(relationId)}`,
      undefined, undefined, options?.signal,
    );
  }

  /** Get proactive memory suggestions. */
  async suggested(params: SuggestedParams = {}, options?: { signal?: AbortSignal }): Promise<SuggestedResponse> {
    const query: Record<string, string> = {};
    if (params.limit !== undefined) query['limit'] = String(params.limit);
    if (params.namespace) query['namespace'] = params.namespace;
    if (params.session_id) query['session_id'] = params.session_id;
    if (params.agent_id) query['agent_id'] = params.agent_id;
    if (params.category) query['category'] = params.category;
    return this.request<SuggestedResponse>('GET', '/v1/suggested', undefined, query, options?.signal);
  }

  // ── Migrate ────────────────────────────────────────────

  /** Bulk import markdown memory files via POST /v1/migrate. */
  async migrate(
    files: MigrateFile[],
    options?: {
      namespace?: string;
      agent_id?: string;
      session_id?: string;
      auto_tag?: boolean;
      signal?: AbortSignal;
    },
  ): Promise<MigrateResponse> {
    if (!files.length) {
      throw new Error('files array must not be empty');
    }
    const body: MigrateRequest = { files };
    if (options?.namespace !== undefined) body.namespace = options.namespace;
    if (options?.agent_id !== undefined) body.agent_id = options.agent_id;
    if (options?.session_id !== undefined) body.session_id = options.session_id;
    if (options?.auto_tag !== undefined) body.auto_tag = options.auto_tag;
    return this.request<MigrateResponse>('POST', '/v1/migrate', body, undefined, options?.signal);
  }

  // ── Context ─────────────────────────────────────────────

  /** Assemble a context block from memories for LLM prompts. */
  async assembleContext(request: ContextRequest, options?: { signal?: AbortSignal }): Promise<ContextResponse> {
    if (!request.query?.trim()) throw new Error('query must be a non-empty string');
    return this.request<ContextResponse>('POST', '/v1/context', request, undefined, options?.signal);
  }

  // ── Namespaces ─────────────────────────────────────────

  /** List all namespaces with memory counts. */
  async listNamespaces(options?: { signal?: AbortSignal }): Promise<NamespacesResponse> {
    return this.request<NamespacesResponse>('GET', '/v1/namespaces', undefined, undefined, options?.signal);
  }

  // ── Stats ──────────────────────────────────────────────

  /** Get memory usage statistics. */
  async stats(options?: { signal?: AbortSignal }): Promise<StatsResponse> {
    return this.request<StatsResponse>('GET', '/v1/stats', undefined, undefined, options?.signal);
  }

  // ── Core Memories ──────────────────────────────────────

  /** Get high-importance, pinned, and frequently-accessed memories (FREE). */
  async coreMemories(params: CoreMemoriesParams = {}, options?: { signal?: AbortSignal }): Promise<CoreMemoriesResponse> {
    const query: Record<string, string> = {};
    if (params.limit !== undefined) query['limit'] = String(params.limit);
    if (params.namespace) query['namespace'] = params.namespace;
    if (params.agent_id) query['agent_id'] = params.agent_id;
    return this.request<CoreMemoriesResponse>('GET', '/v1/core-memories', undefined, Object.keys(query).length ? query : undefined, options?.signal);
  }

  // ── Text Search ───────────────────────────────────────

  /** Keyword text search across memories (FREE). */
  async textSearch(params: TextSearchParams, options?: { signal?: AbortSignal }): Promise<TextSearchResponse> {
    if (!params.query?.trim()) {
      throw new Error('query must be a non-empty string');
    }
    const query: Record<string, string> = { q: params.query };
    if (params.limit !== undefined) query['limit'] = String(params.limit);
    if (params.namespace) query['namespace'] = params.namespace;
    if (params.tags?.length) query['tags'] = params.tags.join(',');
    if (params.memory_type) query['memory_type'] = params.memory_type;
    if (params.session_id) query['session_id'] = params.session_id;
    if (params.agent_id) query['agent_id'] = params.agent_id;
    if (params.after) query['after'] = params.after;
    return this.request<TextSearchResponse>('GET', '/v1/memories/search', undefined, query, options?.signal);
  }

  // ── Export ─────────────────────────────────────────────

  /** Export memories in JSON, CSV, or Markdown format. */
  async export(params: ExportParams = {}, options?: { signal?: AbortSignal }): Promise<ExportResponse> {
    const query: Record<string, string> = {};
    if (params.format) query['format'] = params.format;
    if (params.namespace) query['namespace'] = params.namespace;
    if (params.memory_type) query['memory_type'] = params.memory_type;
    if (params.tags?.length) query['tags'] = params.tags.join(',');
    if (params.session_id) query['session_id'] = params.session_id;
    if (params.agent_id) query['agent_id'] = params.agent_id;
    if (params.before) query['before'] = params.before;
    if (params.after) query['after'] = params.after;
    if (params.include_deleted !== undefined) query['include_deleted'] = String(params.include_deleted);
    return this.request<ExportResponse>('GET', '/v1/export', undefined, query, options?.signal);
  }

  // ── History ────────────────────────────────────────────

  /** Get the change history for a memory. */
  async getHistory(memoryId: string, options?: { signal?: AbortSignal }): Promise<HistoryEntry[]> {
    if (!memoryId?.trim()) throw new Error('memoryId must be a non-empty string');
    const resp = await this.request<HistoryResponse>(
      'GET', `/v1/memories/${encodeURIComponent(memoryId)}/history`,
      undefined, undefined, options?.signal,
    );
    return resp.history;
  }

  // ── Pagination iterator ───────────────────────────────

  /**
   * @deprecated Use {@link iterMemories} instead. Will be removed in a future major version.
   */
  listAll(params: Omit<ListMemoriesParams, 'offset'> & { batchSize?: number } = {}): AsyncGenerator<Memory> {
    return this.iterMemories(params);
  }

  // ── Graph helpers ─────────────────────────────────────

  /** Traverse the memory graph from a starting node up to `depth` hops. */
  async getMemoryGraph(memoryId: string, depth = 1): Promise<Map<string, ListRelationsResponse['relations']>> {
    const visited = new Map<string, ListRelationsResponse['relations']>();
    let frontier = [memoryId];

    for (let d = 0; d < depth; d++) {
      const nextFrontier: string[] = [];
      for (const mid of frontier) {
        if (visited.has(mid)) continue;
        const { relations } = await this.listRelations(mid);
        visited.set(mid, relations);
        for (const rel of relations) {
          if (!visited.has(rel.memory.id)) {
            nextFrontier.push(rel.memory.id);
          }
        }
      }
      frontier = nextFrontier;
      if (frontier.length === 0) break;
    }

    return visited;
  }

  /** Find relations for a memory, optionally filtered by type and/or direction. */
  async findRelated(
    memoryId: string,
    options: { relationType?: RelationType; direction?: 'outgoing' | 'incoming' } = {},
  ): Promise<ListRelationsResponse['relations']> {
    const { relations } = await this.listRelations(memoryId);
    return relations.filter((r) => {
      if (options.relationType && r.relation_type !== options.relationType) return false;
      if (options.direction && r.direction !== options.direction) return false;
      return true;
    });
  }

  // ── Context Manager (using block) ───────────────────

  /**
   * Enable using-block syntax for automatic cleanup.
   * Uses explicit Symbol.dispose method for ES2024+ compatibility.
   * 
   * @example
   * ```ts
   * using client = new MemoClawClient({ wallet: '0x...' });
   * await client.store({ content: 'Memory' });
   * // Automatically cleaned up here
   * ```
   */
  [Symbol.dispose](): void {
    // Cleanup hook - can be used for closing connections, aborting pending requests, etc.
    // For fetch-based client, this is a no-op but provides the interface for resource management
  }

  /**
   * Alias for Symbol.dispose - explicit method name for cleanup.
   */
  dispose(): void {
    // Placeholder for resource cleanup
  }

  /**
   * Create a client wrapped in a Disposable for automatic cleanup.
   * 
   * @example
   * ```ts
   * {
   *   using client = MemoClawClient.disposable({ wallet: '0x...' });
   *   await client.store({ content: 'Memory' });
   * } // Automatically cleaned up
   * ```
   */
  static disposable(options: MemoClawOptions): { client: MemoClawClient; [Symbol.dispose]: () => void } {
    const client = new MemoClawClient(options);
    return {
      client,
      [Symbol.dispose]() {
        // Cleanup resources
      },
    };
  }
}

export { MemoClawError } from './errors.js';
