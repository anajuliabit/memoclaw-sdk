import type {
  MemoClawOptions,
  MemoClawErrorBody,
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
} from './types.js';

const DEFAULT_BASE_URL = 'https://api.memoclaw.com';

/** Error thrown by the MemoClaw SDK when the API returns a non-2xx response. */
export class MemoClawError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'MemoClawError';
  }
}

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
/** Status codes that are safe to retry (transient errors). */
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

export class MemoClawClient {
  private readonly baseUrl: string;
  private readonly wallet: string | undefined;
  private readonly sessionToken: string | undefined;
  private readonly signMessage: ((message: string) => Promise<string>) | undefined;
  private readonly _fetch: typeof globalThis.fetch;
  private readonly maxRetries: number;
  private readonly retryDelay: number;

  constructor(options: MemoClawOptions) {
    if (!options.sessionToken && !options.wallet) {
      throw new Error('Either sessionToken or wallet is required');
    }
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.wallet = options.wallet;
    this.sessionToken = options.sessionToken;
    this.signMessage = options.signMessage;
    this._fetch = options.fetch ?? globalThis.fetch;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryDelay = options.retryDelay ?? 500;
  }

  // ── Internal helpers ───────────────────────────────

  private async request<T>(method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<T> {
    let url = `${this.baseUrl}${path}`;
    if (query) {
      const params = new URLSearchParams(query);
      url += `?${params.toString()}`;
    }

    const headers: Record<string, string> = {};

    // Auth: prefer session token, then wallet signature, then plain wallet (deprecated)
    if (this.sessionToken) {
      headers['Authorization'] = `Bearer ${this.sessionToken}`;
    } else if (this.wallet && this.signMessage) {
      const timestamp = Math.floor(Date.now() / 1000);
      const message = `memoclaw-auth:${timestamp}`;
      const signature = await this.signMessage(message);
      headers['x-wallet-auth'] = `${this.wallet}:${timestamp}:${signature}`;
    } else if (this.wallet) {
      // Deprecated: plain wallet header (API may reject this)
      headers['X-Wallet'] = this.wallet;
    }

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const jsonBody = body !== undefined ? JSON.stringify(body) : undefined;

    let lastError: MemoClawError | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        // Exponential backoff with jitter
        const delay = this.retryDelay * Math.pow(2, attempt - 1);
        const jitter = delay * 0.25 * Math.random();
        await new Promise((resolve) => setTimeout(resolve, delay + jitter));
      }

      let res: Response;
      try {
        res = await this._fetch(url, { method, headers, body: jsonBody });
      } catch (err) {
        // Network error — retry if attempts remain
        if (attempt < this.maxRetries) continue;
        throw err;
      }

      if (res.ok) {
        return (await res.json()) as T;
      }

      let errorBody: MemoClawErrorBody | undefined;
      try {
        errorBody = (await res.json()) as MemoClawErrorBody;
      } catch {
        // ignore parse failures
      }

      lastError = new MemoClawError(
        res.status,
        errorBody?.error?.code ?? 'UNKNOWN_ERROR',
        errorBody?.error?.message ?? `HTTP ${res.status}`,
        errorBody?.error?.details,
      );

      // Only retry on transient errors
      if (!RETRYABLE_STATUS_CODES.has(res.status)) {
        throw lastError;
      }
    }

    throw lastError!;
  }

  // ── Public API ─────────────────────────────────────

  /** Store a single memory. */
  async store(request: StoreRequest): Promise<StoreResponse> {
    return this.request<StoreResponse>('POST', '/v1/store', request);
  }

  /** Store multiple memories in a single request (up to 100). */
  async storeBatch(memories: StoreRequest[]): Promise<StoreBatchResponse> {
    return this.request<StoreBatchResponse>('POST', '/v1/store/batch', { memories } satisfies StoreBatchRequest);
  }

  /** Recall memories via semantic search. */
  async recall(request: RecallRequest): Promise<RecallResponse> {
    return this.request<RecallResponse>('POST', '/v1/recall', request);
  }

  /** List memories with pagination and optional filters. */
  async list(params: ListMemoriesParams = {}): Promise<ListMemoriesResponse> {
    const query: Record<string, string> = {};
    if (params.limit !== undefined) query['limit'] = String(params.limit);
    if (params.offset !== undefined) query['offset'] = String(params.offset);
    if (params.tags?.length) query['tags'] = params.tags.join(',');
    if (params.namespace) query['namespace'] = params.namespace;
    if (params.session_id) query['session_id'] = params.session_id;
    if (params.agent_id) query['agent_id'] = params.agent_id;
    return this.request<ListMemoriesResponse>('GET', '/v1/memories', undefined, query);
  }

  /** Retrieve a single memory by ID. */
  async get(id: string): Promise<Memory> {
    return this.request<Memory>('GET', `/v1/memories/${id}`);
  }

  /** Update a memory by ID. */
  async update(id: string, request: UpdateMemoryRequest): Promise<Memory> {
    return this.request<Memory>('PATCH', `/v1/memories/${id}`, request);
  }

  /** Delete a memory by ID (soft delete). */
  async delete(id: string): Promise<DeleteResponse> {
    return this.request<DeleteResponse>('DELETE', `/v1/memories/${id}`);
  }

  /** Ingest a conversation or text and auto-extract memories. */
  async ingest(request: IngestRequest): Promise<IngestResponse> {
    return this.request<IngestResponse>('POST', '/v1/ingest', request);
  }

  /** Check free tier remaining calls. */
  async status(): Promise<FreeTierStatus> {
    return this.request<FreeTierStatus>('GET', '/v1/free-tier/status');
  }

  /** Extract structured facts from a conversation via LLM. */
  async extract(request: ExtractRequest): Promise<ExtractResponse> {
    return this.request<ExtractResponse>('POST', '/v1/memories/extract', request);
  }

  /** Merge similar memories by clustering. */
  async consolidate(request: ConsolidateRequest = {}): Promise<ConsolidateResponse> {
    return this.request<ConsolidateResponse>('POST', '/v1/memories/consolidate', request);
  }

  /** Create a relationship between two memories. */
  async createRelation(memoryId: string, request: CreateRelationRequest): Promise<CreateRelationResponse> {
    return this.request<CreateRelationResponse>('POST', `/v1/memories/${memoryId}/relations`, request);
  }

  /** List all relationships for a memory. */
  async listRelations(memoryId: string): Promise<ListRelationsResponse> {
    return this.request<ListRelationsResponse>('GET', `/v1/memories/${memoryId}/relations`);
  }

  /** Delete a relationship. */
  async deleteRelation(memoryId: string, relationId: string): Promise<DeleteRelationResponse> {
    return this.request<DeleteRelationResponse>('DELETE', `/v1/memories/${memoryId}/relations/${relationId}`);
  }

  /** Check free tier remaining calls for this wallet. */
  async status(): Promise<FreeTierStatus> {
    return this.request<FreeTierStatus>('GET', '/v1/free-tier/status');
  }

  /** Get proactive memory suggestions. */
  async suggested(params: SuggestedParams = {}): Promise<SuggestedResponse> {
    const query: Record<string, string> = {};
    if (params.limit !== undefined) query['limit'] = String(params.limit);
    if (params.namespace) query['namespace'] = params.namespace;
    if (params.session_id) query['session_id'] = params.session_id;
    if (params.agent_id) query['agent_id'] = params.agent_id;
    if (params.category) query['category'] = params.category;
    return this.request<SuggestedResponse>('GET', '/v1/suggested', undefined, query);
  }
}
