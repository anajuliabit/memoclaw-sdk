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
  DeleteBatchResult,
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
  PingResult,
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
  MemoryGraphParams,
  MemoryGraphResponse,
  Logger,
  LogLevel,
  LogFormat,
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
import { VERSION } from './version.js';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import type { Hex } from 'viem';

const DEFAULT_BASE_URL = 'https://api.memoclaw.com';
const MAX_BATCH_SIZE = 100;
const MAX_CONTENT_LENGTH = 8192;

/** @internal Validate that a limit parameter is a positive integer. */
function validateLimit(limit: number | undefined): void {
  if (limit !== undefined && limit <= 0) {
    throw new Error('limit must be a positive integer');
  }
}

/** @internal Validate that an offset parameter is non-negative. */
function validateOffset(offset: number | undefined): void {
  if (offset !== undefined && offset < 0) {
    throw new Error('offset must be a non-negative integer');
  }
}

/** @internal Validate that min_similarity is in [0, 1]. */
function validateMinSimilarity(minSimilarity: number | undefined): void {
  if (minSimilarity !== undefined && (minSimilarity < 0 || minSimilarity > 1)) {
    throw new Error('min_similarity must be between 0.0 and 1.0');
  }
}

/** @internal Validate that a batch size is positive. */
function validateBatchSize(batchSize: number): void {
  if (batchSize <= 0) {
    throw new Error('batchSize must be a positive integer');
  }
}

/** Status codes that are safe to retry (transient errors). */
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

/** Numeric severity for log-level gating. */
const LOG_LEVEL_SEVERITY: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  none: 99,
};

/** Structured log entry emitted in JSON mode. */
interface StructuredLogEntry {
  timestamp: string;
  level: string;
  logger: string;
  message: string;
  method?: string;
  path?: string;
  status?: number;
  duration_ms?: number;
  request_id?: string;
}

/** Internal helper that wraps a Logger with level-gating and optional JSON formatting. */
function createSdkLogger(
  base: Logger,
  minLevel: LogLevel = 'debug',
  format: LogFormat = 'text',
): Required<Logger> {
  const minSeverity = LOG_LEVEL_SEVERITY[minLevel] ?? 0;

  function emit(level: 'debug' | 'info' | 'warn' | 'error', message: string, ...args: unknown[]): void {
    if ((LOG_LEVEL_SEVERITY[level] ?? 0) < minSeverity) return;

    if (format === 'json') {
      // Build structured entry — extra metadata may be passed as last arg object
      const entry: StructuredLogEntry = {
        timestamp: new Date().toISOString(),
        level,
        logger: 'memoclaw',
        message,
      };
      const lastArg = args[args.length - 1];
      if (lastArg && typeof lastArg === 'object' && !Array.isArray(lastArg)) {
        Object.assign(entry, lastArg);
        args = args.slice(0, -1);
      }
      // Use console methods for JSON so observability tools can still capture stdout/stderr
      const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
      consoleFn(JSON.stringify(entry));
      return;
    }

    // Text mode — delegate to the base logger
    const fn = level === 'debug' ? base.debug
      : level === 'info' ? (base.info ?? base.debug)
      : level === 'warn' ? (base.warn ?? base.debug)
      : (base.error ?? base.debug);
    fn.call(base, message, ...args);
  }

  return {
    debug: (msg, ...a) => emit('debug', msg, ...a),
    info: (msg, ...a) => emit('info', msg, ...a),
    warn: (msg, ...a) => emit('warn', msg, ...a),
    error: (msg, ...a) => emit('error', msg, ...a),
  };
}

/** Options that can be passed to individual API methods. */
export interface RequestOptions {
  /** An AbortSignal for manual cancellation. */
  signal?: AbortSignal;
  /** Per-request timeout in milliseconds. Creates an AbortSignal internally.
   *  Combined with `signal` via `AbortSignal.any` when both are provided. */
  timeout?: number;
}

/** Hook called before each request. Can modify the body. */
export type BeforeRequestHook = (method: string, path: string, body?: unknown) => unknown | void;
/** Hook called after each successful response. */
export type AfterResponseHook = (method: string, path: string, data: unknown) => unknown | void;
/** Hook called on error. */
export type StoreCallback = (result: StoreResponse | StoreBatchResponse) => void | Promise<void>;
export type RecallCallback = (query: string, response: RecallResponse) => void | Promise<void>;
export type DeleteCallback = (id: string, result: DeleteResponse | DeleteBatchResult) => void | Promise<void>;

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
  private readonly enableX402: boolean;
  private readonly _beforeRequestHooks: BeforeRequestHook[] = [];
  private readonly _afterResponseHooks: AfterResponseHook[] = [];
  private readonly _onErrorHooks: OnErrorHook[] = [];
  private readonly _storeCallbacks: StoreCallback[] = [];
  private readonly _recallCallbacks: RecallCallback[] = [];
  private readonly _deleteCallbacks: DeleteCallback[] = [];
  private readonly _logger?: Required<Logger>;

  constructor(options: MemoClawOptions = {}) {
    const config = loadConfig(options.configPath);

    // Resolve private key (optional — allows wallet-only mode for free endpoints)
    const privateKey = options.privateKey
      ?? process.env.MEMOCLAW_PRIVATE_KEY
      ?? config.privateKey;

    if (privateKey) {
      const hex = (privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`) as Hex;
      this._account = privateKeyToAccount(hex);
    } else {
      this._account = null;
    }

    const wallet = options.wallet
      ?? this._account?.address
      ?? process.env.MEMOCLAW_WALLET
      ?? config.wallet;
    if (!wallet || !wallet.trim()) {
      throw new Error(
        'Authentication required. Pass privateKey (for full access) or wallet (for free endpoints), '
        + 'set MEMOCLAW_PRIVATE_KEY / MEMOCLAW_WALLET, '
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
    this.enableX402 = options.enableX402 ?? true;

    // Logging: accepts a custom Logger, or `debug: true` for console output.
    // Wrap with level-gating and optional structured JSON formatting.
    const logLevel: LogLevel = options.logLevel ?? 'debug';
    const logFormat: LogFormat = options.logFormat ?? 'text';

    if (options.logger) {
      this._logger = createSdkLogger(options.logger, logLevel, logFormat);
    } else if (options.debug || options.logLevel) {
      const baseLogger: Logger = {
        debug: (msg: string, ...args: unknown[]) => console.debug(`[memoclaw] ${msg}`, ...args),
        info: (msg: string, ...args: unknown[]) => console.info(`[memoclaw] ${msg}`, ...args),
        warn: (msg: string, ...args: unknown[]) => console.warn(`[memoclaw] ${msg}`, ...args),
        error: (msg: string, ...args: unknown[]) => console.error(`[memoclaw] ${msg}`, ...args),
      };
      this._logger = createSdkLogger(baseLogger, logLevel, logFormat);
    }
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

  /** Register a lifecycle callback fired after successful store/storeBatch calls. */
  onStore(callback: StoreCallback): this {
    this._storeCallbacks.push(callback);
    return this;
  }

  /** Register a lifecycle callback fired after successful recall/search calls. */
  onRecall(callback: RecallCallback): this {
    this._recallCallbacks.push(callback);
    return this;
  }

  /** Register a lifecycle callback fired after delete/deleteBatch calls. */
  onDelete(callback: DeleteCallback): this {
    this._deleteCallbacks.push(callback);
    return this;
  }

  private async emitStoreCallbacks(payload: StoreResponse | StoreBatchResponse): Promise<void> {
    for (const cb of this._storeCallbacks) {
      await cb(payload);
    }
  }

  private async emitRecallCallbacks(query: string, payload: RecallResponse): Promise<void> {
    for (const cb of this._recallCallbacks) {
      await cb(query, payload);
    }
  }

  private async emitDeleteCallbacks(id: string, payload: DeleteResponse | DeleteBatchResult): Promise<void> {
    for (const cb of this._deleteCallbacks) {
      await cb(id, payload);
    }
  }

  // ── Representation ──────────────────────────────────

  /** Human-readable string for debugging. Wallet is truncated for security. */
  toString(): string {
    const w = this.wallet;
    const truncated = w.length > 10 ? `${w.slice(0, 6)}...${w.slice(-4)}` : w;
    const mode = this._account ? 'signed' : 'wallet-only';
    return `MemoClawClient(baseUrl=${JSON.stringify(this.baseUrl)}, wallet=${JSON.stringify(truncated)}, mode=${JSON.stringify(mode)})`;
  }

  /** Custom inspect for Node.js `util.inspect` / `console.log`. */
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return this.toString();
  }

  // ── Internal helpers ───────────────────────────────

  /**
   * Attempt to create x402 payment headers from a 402 response.
   * Returns payment headers on success, or null if x402 is unavailable.
   * @internal
   */
  private async _tryX402Payment(response: Response): Promise<Record<string, string> | null> {
    if (!this.enableX402) return null;
    try {
      // Dynamic import — only loaded if the user has installed x402
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const x402Module: any = await (Function('return import("x402")')() as Promise<any>);
      const createPaymentHeaders = x402Module.createPaymentHeaders ?? x402Module.default?.createPaymentHeaders;
      if (typeof createPaymentHeaders !== 'function') return null;
      const paymentHeaders: Record<string, string> = await createPaymentHeaders(response);
      return paymentHeaders;
    } catch {
      // x402 not installed or payment creation failed
      return null;
    }
  }

  /** Throw if the client is in wallet-only mode (no private key). */
  private requireSignedAuth(method: string): void {
    if (!this._account) {
      throw new Error(
        `${method}() requires a private key for signed authentication. `
        + 'Pass privateKey option, set MEMOCLAW_PRIVATE_KEY, '
        + 'or run `memoclaw init`.',
      );
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string>,
    options?: RequestOptions,
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

    // Generate auth header — signed if private key is available, plain wallet otherwise
    const headers: Record<string, string> = {
      'user-agent': `memoclaw-sdk-ts/${VERSION}`,
    };
    if (this._account) {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const authMessage = `memoclaw-auth:${timestamp}`;
      const signature = await this._account.signMessage({ message: authMessage });
      headers['x-wallet-auth'] = `${this._account.address}:${timestamp}:${signature}`;
    } else {
      headers['x-wallet-auth'] = this.wallet;
    }
    if (processedBody !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const jsonBody = processedBody !== undefined ? JSON.stringify(processedBody) : undefined;

    this._logger?.debug(`${method} ${path}`, query ? `?${new URLSearchParams(query)}` : '', { method, path });
    const startTime = Date.now();

    // Combine caller signal/timeout with client-level timeout
    const signals: AbortSignal[] = [];
    if (options?.signal) signals.push(options.signal);
    if (options?.timeout && options.timeout > 0) signals.push(AbortSignal.timeout(options.timeout));
    if (this.timeout > 0) signals.push(AbortSignal.timeout(this.timeout));
    const combinedSignal = signals.length > 1
      ? AbortSignal.any(signals)
      : signals[0] ?? undefined;

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
        lastError.requestId = res.headers?.get('x-request-id') ?? undefined;
        lastError.retryAttempts = attempt;

        this._logger?.warn(`${method} ${path} → ${res.status} [${code}], retrying in ${delay}ms (attempt ${attempt + 1}/${this.maxRetries})`, {
          method, path, status: res.status, request_id: lastError?.requestId,
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      if (res.ok) {
        const duration = Date.now() - startTime;
        const reqId = res.headers?.get('x-request-id') ?? undefined;
        this._logger?.info(`${method} ${path} → ${res.status} (${duration}ms)`, reqId ? `req=${reqId}` : '', {
          method, path, status: res.status, duration_ms: duration, request_id: reqId,
        });
        let data = (await res.json()) as T;
        // Run after-response hooks
        for (const hook of this._afterResponseHooks) {
          const result = hook(method, path, data);
          if (result !== undefined) data = result as T;
        }
        return data;
      }

      // 402 → attempt x402 automatic payment and retry once
      if (res.status === 402) {
        this._logger?.debug(`${method} ${path} → 402, attempting x402 payment`, { method, path });
        const paymentHeaders = await this._tryX402Payment(res);
        if (paymentHeaders) {
          this._logger?.info(`x402 payment headers created, retrying ${method} ${path}`, { method, path });
          // Retry the request with payment headers merged in
          const retryHeaders = { ...headers, ...paymentHeaders };
          const retryRes = await this._fetch(url, { method, headers: retryHeaders, body: jsonBody, signal: combinedSignal });
          if (retryRes.ok) {
            const duration = Date.now() - startTime;
            const reqId = retryRes.headers?.get('x-request-id') ?? undefined;
            this._logger?.info(`${method} ${path} → ${retryRes.status} (${duration}ms, x402 paid)`, reqId ? `req=${reqId}` : '', {
              method, path, status: retryRes.status, duration_ms: duration, request_id: reqId,
            });
            let data = (await retryRes.json()) as T;
            for (const hook of this._afterResponseHooks) {
              const result = hook(method, path, data);
              if (result !== undefined) data = result as T;
            }
            return data;
          }
          // x402 retry failed — fall through to normal error handling with the retry response
          res = retryRes;
        }
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
      lastError.requestId = res.headers?.get('x-request-id') ?? undefined;
      lastError.retryAttempts = attempt;

      const duration = Date.now() - startTime;
      this._logger?.error(`${method} ${path} → ${res.status} [${code}] (${duration}ms)`, lastError.requestId ? `req=${lastError.requestId}` : '', {
        method, path, status: res.status, duration_ms: duration, request_id: lastError.requestId,
      });

      if (!RETRYABLE_STATUS_CODES.has(res.status)) {
        for (const hook of this._onErrorHooks) hook(method, path, lastError);
        throw lastError;
      }

      this._logger?.warn(`Retrying ${method} ${path} (attempt ${attempt + 1}/${this.maxRetries})`, { method, path });
    }

    if (lastError) {
      for (const hook of this._onErrorHooks) hook(method, path, lastError);
    }
    throw lastError!;
  }

  // ── Public API ─────────────────────────────────────

  /** Store a single memory. */
  async store(request: StoreRequest, options?: RequestOptions): Promise<StoreResponse> {
    this.requireSignedAuth('store');
    if (!request.content?.trim()) {
      throw new Error('content must be a non-empty string');
    }
    if (request.content.length > MAX_CONTENT_LENGTH) {
      throw new Error(`content exceeds the ${MAX_CONTENT_LENGTH} character limit. Split into smaller memories or summarize.`);
    }
    if (request.importance !== undefined && (request.importance < 0 || request.importance > 1)) {
      throw new Error('importance must be between 0.0 and 1.0');
    }
    const result = await this.request<StoreResponse>('POST', '/v1/store', request, undefined, options);
    await this.emitStoreCallbacks(result);
    return result;
  }

  /** Store multiple memories in a single request (up to 100). */
  async storeBatch(memories: StoreRequest[], options?: RequestOptions): Promise<StoreBatchResponse> {
    this.requireSignedAuth('storeBatch');
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
      if (m.content.length > MAX_CONTENT_LENGTH) {
        throw new Error(`content exceeds the ${MAX_CONTENT_LENGTH} character limit. Split into smaller memories or summarize.`);
      }
      if (m.importance !== undefined && (m.importance < 0 || m.importance > 1)) {
        throw new Error('importance must be between 0.0 and 1.0');
      }
    }
    const result = await this.request<StoreBatchResponse>(
      'POST', '/v1/store/batch',
      { memories } satisfies StoreBatchRequest,
      undefined, options,
    );
    await this.emitStoreCallbacks(result);
    return result;
  }

  /** Create a StoreBuilder for fluent memory creation. */
  storeBuilder(): StoreBuilder {
    return new StoreBuilder(this);
  }

  /** Recall memories via semantic search. */
  async recall(request: RecallRequest, options?: RequestOptions): Promise<RecallResponse> {
    this.requireSignedAuth('recall');
    if (!request.query?.trim()) {
      throw new Error('query must be a non-empty string');
    }
    validateLimit(request.limit);
    validateMinSimilarity(request.min_similarity);
    const data = await this.request<RecallResponse>('POST', '/v1/recall', request, undefined, options);
    // Populate `signals` alias from `_signals` for cleaner API (mirrors Python SDK)
    for (const mem of data.memories) {
      if (mem._signals && !mem.signals) {
        mem.signals = mem._signals;
      }
    }
    await this.emitRecallCallbacks(request.query, data);
    return data;
  }

  /** List memories with pagination and optional filters. */
  async list(params: ListMemoriesParams = {}, options?: RequestOptions): Promise<ListMemoriesResponse> {
    validateLimit(params.limit);
    validateOffset(params.offset);
    const query: Record<string, string> = {};
    if (params.limit !== undefined) query['limit'] = String(params.limit);
    if (params.offset !== undefined) query['offset'] = String(params.offset);
    if (params.tags?.length) query['tags'] = params.tags.join(',');
    if (params.namespace) query['namespace'] = params.namespace;
    if (params.session_id) query['session_id'] = params.session_id;
    if (params.agent_id) query['agent_id'] = params.agent_id;
    if (params.memory_type) query['memory_type'] = params.memory_type;
    if (params.before) query['before'] = params.before;
    if (params.after) query['after'] = params.after;
    if (params.include_deleted !== undefined) query['include_deleted'] = String(params.include_deleted);
    return this.request<ListMemoriesResponse>('GET', '/v1/memories', undefined, query, options);
  }

  /** Count memories matching the given filters without fetching all data.
   *
   * @example
   * ```ts
   * const total = await client.count();
   * const projectCount = await client.count({ namespace: 'project-x' });
   * ```
   */
  async count(params: Omit<ListMemoriesParams, 'limit' | 'offset'> = {}, options?: RequestOptions): Promise<number> {
    const page = await this.list({ ...params, limit: 1, offset: 0 }, options);
    return page.total;
  }

  /** Async iterator over all memories with automatic pagination. */
  async *iterMemories(params: Omit<ListMemoriesParams, 'offset'> & { batchSize?: number } = {}): AsyncGenerator<Memory, void, unknown> {
    const { batchSize = 50, ...rest } = params;
    validateBatchSize(batchSize);
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
  async get(id: string, options?: RequestOptions): Promise<Memory> {
    if (!id?.trim()) throw new Error('id must be a non-empty string');
    return this.request<Memory>('GET', `/v1/memories/${encodeURIComponent(id)}`, undefined, undefined, options);
  }

  /**
   * Check whether a memory exists by ID.
   *
   * Returns `true` if the memory exists, `false` if it was deleted or never
   * existed (404). Other errors (auth, network) are raised normally.
   *
   * Uses the free `GET /v1/memories/{id}` endpoint — works in wallet-only mode.
   *
   * @example
   * ```ts
   * if (await client.exists('mem-123')) {
   *   await client.update('mem-123', { content: 'Updated' });
   * }
   * ```
   */
  async exists(id: string, options?: RequestOptions): Promise<boolean> {
    if (!id?.trim()) throw new Error('id must be a non-empty string');
    try {
      await this.request<Memory>('GET', `/v1/memories/${encodeURIComponent(id)}`, undefined, undefined, options);
      return true;
    } catch (err) {
      if (err instanceof NotFoundError) {
        return false;
      }
      throw err;
    }
  }

  /** Update a memory by ID. */
  async update(id: string, request: UpdateMemoryRequest, options?: RequestOptions): Promise<Memory> {
    this.requireSignedAuth('update');
    if (!id?.trim()) throw new Error('id must be a non-empty string');
    if (request.content !== undefined && request.content.length > MAX_CONTENT_LENGTH) {
      throw new Error(`content exceeds the ${MAX_CONTENT_LENGTH} character limit. Split into smaller memories or summarize.`);
    }
    if (request.importance !== undefined && (request.importance < 0 || request.importance > 1)) {
      throw new Error('importance must be between 0.0 and 1.0');
    }
    return this.request<Memory>('PATCH', `/v1/memories/${encodeURIComponent(id)}`, request, undefined, options);
  }

  /** Update multiple memories in a single request (up to 100). */
  async updateBatch(updates: UpdateBatchItem[], options?: RequestOptions): Promise<UpdateBatchResponse> {
    this.requireSignedAuth('updateBatch');
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
      if (u.content !== undefined && u.content.length > MAX_CONTENT_LENGTH) {
        throw new Error(`content exceeds the ${MAX_CONTENT_LENGTH} character limit. Split into smaller memories or summarize.`);
      }
      if (u.importance !== undefined && (u.importance < 0 || u.importance > 1)) {
        throw new Error('importance must be between 0.0 and 1.0');
      }
    }
    return this.request<UpdateBatchResponse>(
      'PATCH', '/v1/memories/batch',
      { updates } satisfies UpdateBatchRequest,
      undefined, options,
    );
  }

  /** Delete a memory by ID (soft delete). */
  async delete(id: string, options?: RequestOptions): Promise<DeleteResponse> {
    if (!id?.trim()) throw new Error('id must be a non-empty string');
    const result = await this.request<DeleteResponse>('DELETE', `/v1/memories/${encodeURIComponent(id)}`, undefined, undefined, options);
    await this.emitDeleteCallbacks(id, result);
    return result;
  }

  /** Delete multiple memories by ID in batch. */
  async deleteBatch(ids: string[], options?: RequestOptions): Promise<DeleteBatchResult[]> {
    if (!ids.length) {
      throw new Error('ids array must not be empty');
    }
    const results: DeleteBatchResult[] = [];
    // Process in chunks of 50
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const response = await this.request<{ results: DeleteBatchResult[] }>(
        'POST',
        '/v1/memories/batch-delete',
        { ids: chunk },
        undefined, options,
      );
      for (const entry of response.results) {
        results.push(entry);
        await this.emitDeleteCallbacks(entry.id, entry);
      }
    }
    return results;
  }

  /** Alias for recall — matches Mem0/Pinecone "search" convention. */
  search(request: RecallRequest, options?: RequestOptions): Promise<RecallResponse> {
    return this.recall(request, options);
  }

  /** Ingest a conversation or text and auto-extract memories. */
  async ingest(request: IngestRequest, options?: RequestOptions): Promise<IngestResponse> {
    this.requireSignedAuth('ingest');
    if (!request.messages?.length && !request.text?.trim()) {
      throw new Error('Either messages or text must be provided');
    }
    return this.request<IngestResponse>('POST', '/v1/ingest', request, undefined, options);
  }

  /** Check free tier remaining calls. */
  async status(options?: RequestOptions): Promise<FreeTierStatus> {
    return this.request<FreeTierStatus>('GET', '/v1/free-tier/status', undefined, undefined, options);
  }

  /**
   * Get public free tier policy info. No authentication required.
   *
   * @example
   * ```ts
   * const info = await client.freeTierInfo();
   * console.log(info.free_tier.calls_per_wallet); // 100
   * ```
   */
  async freeTierInfo(options?: RequestOptions): Promise<import('./types.js').FreeTierInfo> {
    return this.request<import('./types.js').FreeTierInfo>('GET', '/v1/free-tier/info', undefined, undefined, options);
  }

  /**
   * Exchange wallet signature for a JWT session token.
   *
   * The returned token can be used as `Authorization: Bearer {token}` for
   * subsequent requests, avoiding per-request signing. Tokens are valid for 7 days.
   *
   * @example
   * ```ts
   * const session = await client.createSession();
   * console.log(session.token); // "eyJ..."
   * console.log(session.expires_at); // "2026-03-19T14:00:00Z"
   * ```
   */
  async createSession(options?: RequestOptions): Promise<import('./types.js').SessionAuthResponse> {
    if (!this._account) {
      throw new Error('createSession requires a private key (signed auth). Wallet-only clients cannot create sessions.');
    }
    const timestamp = Math.floor(Date.now() / 1000);
    const message = `memoclaw-auth:${timestamp}`;
    const signature = await this._account.signMessage({ message });
    return this.request<import('./types.js').SessionAuthResponse>('POST', '/auth/session', {
      address: this._account.address,
      timestamp,
      signature,
    }, undefined, options);
  }

  /**
   * Validate SDK configuration with a lightweight health check.
   *
   * Calls the free-tier status endpoint to verify connectivity and auth,
   * and measures round-trip latency.
   *
   * @example
   * ```ts
   * const health = await client.ping();
   * console.log(health); // { ok: true, latencyMs: 42, auth: 'signed', freeTierRemaining: 87 }
   * ```
   */
  async ping(options?: RequestOptions): Promise<PingResult> {
    const authMode: PingResult['auth'] = this._account ? 'signed' : 'wallet-only';
    const start = performance.now();
    try {
      const ft = await this.status(options);
      const latencyMs = Math.round((performance.now() - start) * 10) / 10;
      return {
        ok: true,
        latencyMs,
        auth: authMode,
        freeTierRemaining: ft.free_tier_remaining,
      };
    } catch {
      const latencyMs = Math.round((performance.now() - start) * 10) / 10;
      return {
        ok: false,
        latencyMs,
        auth: authMode,
        freeTierRemaining: 0,
      };
    }
  }

  /**
   * Async factory that optionally validates the connection on creation.
   *
   * @example
   * ```ts
   * const client = await MemoClawClient.create({ wallet: '0x...', validateOnInit: true });
   * // Connection already verified!
   * ```
   */
  static async create(options: MemoClawOptions = {}): Promise<MemoClawClient> {
    const client = new MemoClawClient(options);
    if (options.validateOnInit) {
      const result = await client.ping();
      if (!result.ok) {
        throw new Error(
          `MemoClaw health check failed (latency: ${result.latencyMs.toFixed(0)}ms). `
          + 'Check your network connection and baseUrl.',
        );
      }
    }
    return client;
  }

  /** Extract structured facts from a conversation via LLM. */
  async extract(request: ExtractRequest, options?: RequestOptions): Promise<ExtractResponse> {
    this.requireSignedAuth('extract');
    if (!request.messages?.length) {
      throw new Error('messages must be a non-empty array');
    }
    return this.request<ExtractResponse>('POST', '/v1/memories/extract', request, undefined, options);
  }

  /** Merge similar memories by clustering. */
  async consolidate(request: ConsolidateRequest = {}, options?: RequestOptions): Promise<ConsolidateResponse> {
    this.requireSignedAuth('consolidate');
    return this.request<ConsolidateResponse>('POST', '/v1/memories/consolidate', request, undefined, options);
  }

  /** Create a relationship between two memories. */
  async createRelation(memoryId: string, request: CreateRelationRequest, options?: RequestOptions): Promise<CreateRelationResponse> {
    this.requireSignedAuth('createRelation');
    if (!memoryId?.trim()) throw new Error('memoryId must be a non-empty string');
    if (!request.target_id?.trim()) throw new Error('target_id must be a non-empty string');
    return this.request<CreateRelationResponse>(
      'POST', `/v1/memories/${encodeURIComponent(memoryId)}/relations`,
      request, undefined, options,
    );
  }

  /** List all relationships for a memory. */
  async listRelations(memoryId: string, options?: RequestOptions): Promise<ListRelationsResponse> {
    if (!memoryId?.trim()) throw new Error('memoryId must be a non-empty string');
    return this.request<ListRelationsResponse>(
      'GET', `/v1/memories/${encodeURIComponent(memoryId)}/relations`,
      undefined, undefined, options,
    );
  }

  /** Delete a relationship. */
  async deleteRelation(memoryId: string, relationId: string, options?: RequestOptions): Promise<DeleteRelationResponse> {
    this.requireSignedAuth('deleteRelation');
    if (!memoryId?.trim()) throw new Error('memoryId must be a non-empty string');
    if (!relationId?.trim()) throw new Error('relationId must be a non-empty string');
    return this.request<DeleteRelationResponse>(
      'DELETE', `/v1/memories/${encodeURIComponent(memoryId)}/relations/${encodeURIComponent(relationId)}`,
      undefined, undefined, options,
    );
  }

  /** Get proactive memory suggestions. */
  async suggested(params: SuggestedParams = {}, options?: RequestOptions): Promise<SuggestedResponse> {
    validateLimit(params.limit);
    const query: Record<string, string> = {};
    if (params.limit !== undefined) query['limit'] = String(params.limit);
    if (params.namespace) query['namespace'] = params.namespace;
    if (params.session_id) query['session_id'] = params.session_id;
    if (params.agent_id) query['agent_id'] = params.agent_id;
    if (params.category) query['category'] = params.category;
    return this.request<SuggestedResponse>('GET', '/v1/suggested', undefined, query, options);
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
    } & RequestOptions,
  ): Promise<MigrateResponse> {
    this.requireSignedAuth('migrate');
    if (!files.length) {
      throw new Error('files array must not be empty');
    }
    const body: MigrateRequest = { files };
    if (options?.namespace !== undefined) body.namespace = options.namespace;
    if (options?.agent_id !== undefined) body.agent_id = options.agent_id;
    if (options?.session_id !== undefined) body.session_id = options.session_id;
    if (options?.auto_tag !== undefined) body.auto_tag = options.auto_tag;
    return this.request<MigrateResponse>('POST', '/v1/migrate', body, undefined, options);
  }

  /**
   * Convenience: migrate all matching files from a directory.
   * Reads files from disk and sends them via the migrate endpoint.
   *
   * @param directory - Path to directory containing memory files
   * @param options.pattern - Glob pattern (default: `*.md`)
   *
   * @example
   * ```ts
   * const result = await client.migrateDirectory('./memories', {
   *   namespace: 'project-x',
   * });
   * ```
   */
  async migrateDirectory(
    directory: string,
    options?: {
      pattern?: string;
      namespace?: string;
      agent_id?: string;
      session_id?: string;
      auto_tag?: boolean;
    } & RequestOptions,
  ): Promise<MigrateResponse> {
    const { readdir, readFile, stat } = await import('node:fs/promises');
    const { join, basename } = await import('node:path');
    const { resolve } = await import('node:path');

    const dirPath = resolve(directory);
    const dirStat = await stat(dirPath).catch(() => null);
    if (!dirStat?.isDirectory()) {
      throw new Error(`Directory not found: ${directory}`);
    }

    const pattern = options?.pattern ?? '*.md';
    // Simple glob matching: convert pattern to regex
    const regexStr = '^' + pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.') + '$';
    const regex = new RegExp(regexStr);

    const entries = await readdir(dirPath);
    const matchingFiles = entries.filter((f) => regex.test(f)).sort();

    const files: MigrateFile[] = [];
    for (const filename of matchingFiles) {
      const filePath = join(dirPath, filename);
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) continue;
      const content = await readFile(filePath, 'utf-8');
      files.push({ filename, content });
    }

    if (!files.length) {
      throw new Error(`No files matching '${pattern}' in ${directory}`);
    }

    return this.migrate(files, {
      namespace: options?.namespace,
      agent_id: options?.agent_id,
      session_id: options?.session_id,
      auto_tag: options?.auto_tag,
      signal: options?.signal,
      timeout: options?.timeout,
    });
  }

  // ── Context ─────────────────────────────────────────────

  /** Assemble a context block from memories for LLM prompts. */
  async assembleContext(request: ContextRequest, options?: RequestOptions): Promise<ContextResponse> {
    this.requireSignedAuth('assembleContext');
    if (!request.query?.trim()) throw new Error('query must be a non-empty string');
    return this.request<ContextResponse>('POST', '/v1/context', request, undefined, options);
  }

  // ── Namespaces ─────────────────────────────────────────

  /** List all namespaces with memory counts. */
  async listNamespaces(options?: RequestOptions): Promise<NamespacesResponse> {
    return this.request<NamespacesResponse>('GET', '/v1/namespaces', undefined, undefined, options);
  }

  /**
   * Delete all memories in a namespace.
   *
   * Iterates through all memories in the given namespace and deletes
   * them in batches. Returns a summary with the total count deleted.
   *
   * @example
   * ```ts
   * const result = await client.deleteNamespace('test-data');
   * console.log(`Deleted ${result.deletedCount} memories`);
   * ```
   */
  async deleteNamespace(
    namespace: string,
    options?: { batchSize?: number } & RequestOptions,
  ): Promise<import('./types.js').DeleteNamespaceResult> {
    if (!namespace?.trim()) throw new Error('namespace must be a non-empty string');
    const batchSize = options?.batchSize ?? 50;
    validateBatchSize(batchSize);
    let totalDeleted = 0;
    while (true) {
      const page = await this.list({ limit: batchSize, namespace }, options);
      if (page.memories.length === 0) break;
      const ids = page.memories.map((m) => m.id);
      await this.deleteBatch(ids, options);
      totalDeleted += ids.length;
    }
    return { deleted: totalDeleted > 0, deletedCount: totalDeleted };
  }

  // ── Stats ──────────────────────────────────────────────

  /** Get memory usage statistics. */
  async stats(options?: RequestOptions): Promise<StatsResponse> {
    return this.request<StatsResponse>('GET', '/v1/stats', undefined, undefined, options);
  }

  // ── Core Memories ──────────────────────────────────────

  /** Get high-importance, pinned, and frequently-accessed memories (FREE). */
  async coreMemories(params: CoreMemoriesParams = {}, options?: RequestOptions): Promise<CoreMemoriesResponse> {
    validateLimit(params.limit);
    const query: Record<string, string> = {};
    if (params.limit !== undefined) query['limit'] = String(params.limit);
    if (params.namespace) query['namespace'] = params.namespace;
    if (params.agent_id) query['agent_id'] = params.agent_id;
    return this.request<CoreMemoriesResponse>('GET', '/v1/memories/core', undefined, Object.keys(query).length ? query : undefined, options);
  }

  /**
   * Pin a memory as a core memory (FREE).
   * Uses the dedicated POST /v1/memories/core endpoint which is free,
   * unlike update(id, { pinned: true }) which costs $0.005.
   */
  async pinCoreMemory(memoryId: string, options?: RequestOptions): Promise<import('./types.js').PinCoreMemoryResult> {
    if (!memoryId?.trim()) throw new Error('memoryId must be a non-empty string');
    return this.request<import('./types.js').PinCoreMemoryResult>(
      'POST', '/v1/memories/core', { memory_id: memoryId }, undefined, options,
    );
  }

  /**
   * Unpin a core memory (FREE).
   * Uses the dedicated DELETE /v1/memories/core/:id endpoint which is free,
   * unlike update(id, { pinned: false }) which costs $0.005.
   * The memory is not deleted — it resumes normal type-based decay.
   */
  async unpinCoreMemory(memoryId: string, options?: RequestOptions): Promise<import('./types.js').UnpinCoreMemoryResult> {
    if (!memoryId?.trim()) throw new Error('memoryId must be a non-empty string');
    return this.request<import('./types.js').UnpinCoreMemoryResult>(
      'DELETE', `/v1/memories/core/${encodeURIComponent(memoryId)}`, undefined, undefined, options,
    );
  }

  // ── Text Search ───────────────────────────────────────

  /** Keyword text search across memories (FREE). */
  async textSearch(params: TextSearchParams, options?: RequestOptions): Promise<TextSearchResponse> {
    if (!params.query?.trim()) {
      throw new Error('query must be a non-empty string');
    }
    validateLimit(params.limit);
    const body: Record<string, unknown> = { query: params.query };
    if (params.limit !== undefined) body['limit'] = params.limit;
    if (params.namespace) body['namespace'] = params.namespace;
    if (params.tags?.length) body['tags'] = params.tags;
    if (params.memory_type) body['memory_type'] = params.memory_type;
    if (params.session_id) body['session_id'] = params.session_id;
    if (params.agent_id) body['agent_id'] = params.agent_id;
    if (params.after) body['after'] = params.after;
    return this.request<TextSearchResponse>('POST', '/v1/search', body, undefined, options);
  }

  // ── Export ─────────────────────────────────────────────

  /** Export memories in JSON, CSV, or Markdown format. */
  async export(params: ExportParams = {}, options?: RequestOptions): Promise<ExportResponse> {
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
    return this.request<ExportResponse>('GET', '/v1/export', undefined, query, options);
  }

  /**
   * Iterate over exportable memories with automatic pagination.
   *
   * Unlike {@link export} which loads all memories into a single response,
   * this method yields individual {@link Memory} objects in batches,
   * making it memory-efficient for large memory sets.
   *
   * @param params - Filter parameters and optional batchSize (default 50).
   */
  async *iterExport(
    params: Omit<ExportParams, 'format'> & { batchSize?: number } = {},
  ): AsyncGenerator<Memory, void, unknown> {
    const { batchSize = 50, ...filters } = params;
    validateBatchSize(batchSize);
    let offset = 0;
    while (true) {
      const page = await this.list({
        limit: batchSize,
        offset,
        namespace: filters.namespace,
        tags: filters.tags,
        session_id: filters.session_id,
        agent_id: filters.agent_id,
        memory_type: filters.memory_type,
        before: filters.before,
        after: filters.after,
        include_deleted: filters.include_deleted,
      });
      for (const mem of page.memories) {
        yield mem;
      }
      offset += page.memories.length;
      if (offset >= page.total || page.memories.length === 0) break;
    }
  }

  // ── History ────────────────────────────────────────────

  /** Get the change history for a memory. */
  async getHistory(memoryId: string, options?: RequestOptions): Promise<HistoryEntry[]> {
    if (!memoryId?.trim()) throw new Error('memoryId must be a non-empty string');
    const resp = await this.request<HistoryResponse>(
      'GET', `/v1/memories/${encodeURIComponent(memoryId)}/history`,
      undefined, undefined, options,
    );
    return resp.history;
  }

  // ── Pagination iterator ───────────────────────────────

  /**
   * @deprecated Use {@link iterMemories} instead. Will be removed in a future major version.
   */
  listAll(params: Omit<ListMemoriesParams, 'offset'> & { batchSize?: number } = {}): AsyncGenerator<Memory> {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[memoclaw] listAll() is deprecated, use iterMemories() instead');
    }
    return this.iterMemories(params);
  }

  // ── Graph helpers ─────────────────────────────────────

  /** Traverse the memory graph from a starting node using the server-side endpoint.
   *
   * Returns a structured graph with root, nodes, edges, and traversal depth.
   * Uses `GET /v1/memories/{id}/graph` which is more efficient than
   * client-side traversal (single request vs N+1 requests).
   */
  async getMemoryGraph(
    memoryId: string,
    params: MemoryGraphParams = {},
    options?: RequestOptions,
  ): Promise<MemoryGraphResponse> {
    if (!memoryId?.trim()) throw new Error('memoryId must be a non-empty string');
    const query: Record<string, string> = {};
    if (params.depth !== undefined) query['depth'] = String(params.depth);
    if (params.limit !== undefined) query['limit'] = String(params.limit);
    if (params.relation_types?.length) query['relation_types'] = params.relation_types.join(',');
    return this.request<MemoryGraphResponse>(
      'GET',
      `/v1/memories/${encodeURIComponent(memoryId)}/graph`,
      undefined,
      Object.keys(query).length ? query : undefined,
      options,
    );
  }

  /** Find relations for a memory, optionally filtered by type and/or direction. */
  async findRelated(
    memoryId: string,
    options: { relationType?: RelationType; direction?: 'outgoing' | 'incoming' } & RequestOptions = {},
  ): Promise<ListRelationsResponse['relations']> {
    const { relationType, direction, ...requestOptions } = options;
    const { relations } = await this.listRelations(memoryId, requestOptions);
    return relations.filter((r) => {
      if (relationType && r.relation_type !== relationType) return false;
      if (direction && r.direction !== direction) return false;
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
