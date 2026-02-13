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
export class MemoClawClient {
  private readonly baseUrl: string;
  private readonly wallet: string;
  private readonly _fetch: typeof globalThis.fetch;

  constructor(options: MemoClawOptions) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.wallet = options.wallet;
    this._fetch = options.fetch ?? globalThis.fetch;
  }

  // ── Internal helpers ───────────────────────────────

  private async request<T>(method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<T> {
    let url = `${this.baseUrl}${path}`;
    if (query) {
      const params = new URLSearchParams(query);
      url += `?${params.toString()}`;
    }

    const headers: Record<string, string> = {
      'X-Wallet': this.wallet,
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await this._fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      let errorBody: MemoClawErrorBody | undefined;
      try {
        errorBody = (await res.json()) as MemoClawErrorBody;
      } catch {
        // ignore parse failures
      }
      throw new MemoClawError(
        res.status,
        errorBody?.error?.code ?? 'UNKNOWN_ERROR',
        errorBody?.error?.message ?? `HTTP ${res.status}`,
        errorBody?.error?.details,
      );
    }

    return (await res.json()) as T;
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
