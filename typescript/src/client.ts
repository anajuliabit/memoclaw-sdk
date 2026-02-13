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
  private readonly _fetch: typeof globalThis.fetch;
  private readonly maxRetries: number;
  private readonly retryDelay: number;
  private readonly _beforeRequestHooks: BeforeRequestHook[] = [];
  private readonly _afterResponseHooks: AfterResponseHook[] = [];
  private readonly _onErrorHooks: OnErrorHook[] = [];

  constructor(options: MemoClawOptions = {}) {
    const config = loadConfig(options.configPath);

    const wallet = options.wallet
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

    const headers: Record<string, string> = {
      'X-Wallet': this.wallet,
    };
    if (processedBody !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const jsonBody = processedBody !== undefined ? JSON.stringify(processedBody) : undefined;

    let lastError: MemoClawError | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = this.retryDelay * Math.pow(2, attempt - 1);
        const jitter = delay * 0.25 * Math.random();
        await new Promise((resolve) => setTimeout(resolve, delay + jitter));
      }

      let res: Response;
      try {
        res = await this._fetch(url, { method, headers, body: jsonBody, signal });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err;
        if (attempt < this.maxRetries) continue;
        throw err;
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

  /** Delete a memory by ID (soft delete). */
  async delete(id: string, options?: { signal?: AbortSignal }): Promise<DeleteResponse> {
    if (!id?.trim()) throw new Error('id must be a non-empty string');
    return this.request<DeleteResponse>('DELETE', `/v1/memories/${encodeURIComponent(id)}`, undefined, undefined, options?.signal);
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

  // ── Pagination iterator ───────────────────────────────

  /** Async iterate over all memories with automatic pagination. */
  async *listAll(params: Omit<ListMemoriesParams, 'offset'> & { batchSize?: number } = {}): AsyncGenerator<Memory> {
    const { batchSize = 50, ...listParams } = params;
    let offset = 0;
    while (true) {
      const page = await this.list({ ...listParams, limit: batchSize, offset });
      for (const memory of page.memories) {
        yield memory;
      }
      offset += page.memories.length;
      if (offset >= page.total || page.memories.length === 0) break;
    }
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
}

export { MemoClawError } from './errors.js';
