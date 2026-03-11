import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  MemoClawClient,
  MemoClawError,
  AuthenticationError,
  NotFoundError,
  RateLimitError,
  ValidationError,
  PaymentRequiredError,
  ForbiddenError,
  InternalServerError,
} from '../index.js';

const BASE_URL = 'https://api.memoclaw.com';

function mockFetch(responses: Array<{ status: number; body?: unknown; ok?: boolean; headers?: Record<string, string> }>): typeof globalThis.fetch {
  let callIndex = 0;
  return vi.fn(async () => {
    const resp = responses[callIndex] ?? responses[responses.length - 1]!;
    callIndex++;
    // Normalise header keys to lowercase for consistent lookup
    const rawHeaders = resp.headers ?? {};
    const hdrs = new Map(Object.entries(rawHeaders).map(([k, v]) => [k.toLowerCase(), v]));
    return {
      ok: resp.ok ?? (resp.status >= 200 && resp.status < 300),
      status: resp.status,
      json: async () => resp.body,
      headers: { get: (name: string) => hdrs.get(name.toLowerCase()) ?? null },
    } as Response;
  });
}

// Well-known Hardhat test private key (DO NOT use in production)
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

function createClient(fetchFn: typeof globalThis.fetch) {
  return new MemoClawClient({
    privateKey: TEST_PRIVATE_KEY,
    baseUrl: BASE_URL,
    fetch: fetchFn,
    maxRetries: 1,
    retryDelay: 1,
  });
}

describe('MemoClawClient', () => {
  describe('constructor', () => {
    it('throws if neither privateKey nor wallet is available', () => {
      const origKey = process.env.MEMOCLAW_PRIVATE_KEY;
      const origWallet = process.env.MEMOCLAW_WALLET;
      delete process.env.MEMOCLAW_PRIVATE_KEY;
      delete process.env.MEMOCLAW_WALLET;
      try {
        expect(() => new MemoClawClient({})).toThrow('Authentication required');
      } finally {
        if (origKey !== undefined) process.env.MEMOCLAW_PRIVATE_KEY = origKey;
        if (origWallet !== undefined) process.env.MEMOCLAW_WALLET = origWallet;
      }
    });

    it('rejects empty string wallet address', () => {
      const origKey = process.env.MEMOCLAW_PRIVATE_KEY;
      const origWallet = process.env.MEMOCLAW_WALLET;
      delete process.env.MEMOCLAW_PRIVATE_KEY;
      delete process.env.MEMOCLAW_WALLET;
      try {
        expect(() => new MemoClawClient({ wallet: '' })).toThrow('Authentication required');
        expect(() => new MemoClawClient({ wallet: '   ' })).toThrow('Authentication required');
      } finally {
        if (origKey !== undefined) process.env.MEMOCLAW_PRIVATE_KEY = origKey;
        if (origWallet !== undefined) process.env.MEMOCLAW_WALLET = origWallet;
      }
    });

    it('accepts wallet-only mode without private key', () => {
      const orig = process.env.MEMOCLAW_PRIVATE_KEY;
      delete process.env.MEMOCLAW_PRIVATE_KEY;
      try {
        const client = new MemoClawClient({ wallet: '0xTestWallet', fetch: mockFetch([]) });
        expect(client).toBeDefined();
      } finally {
        if (orig !== undefined) process.env.MEMOCLAW_PRIVATE_KEY = orig;
      }
    });

    it('strips trailing slashes from baseUrl', async () => {
      const f = mockFetch([{ status: 200, body: { wallet: '0x', free_tier_remaining: 10, free_tier_total: 100, free_tier_used: 90 } }]);
      const client = new MemoClawClient({ privateKey: TEST_PRIVATE_KEY, baseUrl: 'https://custom.api.com///', fetch: f });
      await client.status();
      expect(f).toHaveBeenCalledWith(expect.stringContaining('https://custom.api.com/v1'), expect.anything());
    });
  });

  describe('store', () => {
    it('sends POST /v1/store and returns StoreResponse', async () => {
      const f = mockFetch([{ status: 201, body: { id: 'mem-1', stored: true, deduplicated: false, tokens_used: 42 } }]);
      const client = createClient(f);
      const result = await client.store({ content: 'hello world', importance: 0.8 });
      expect(result.id).toBe('mem-1');
      expect(result.tokens_used).toBe(42);
      expect(f).toHaveBeenCalledWith(
        `${BASE_URL}/v1/store`,
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('storeBatch', () => {
    it('sends batch and returns counts', async () => {
      const f = mockFetch([{ status: 201, body: { ids: ['a', 'b'], stored: true, count: 2, deduplicated_count: 0, tokens_used: 80 } }]);
      const client = createClient(f);
      const result = await client.storeBatch([{ content: 'one' }, { content: 'two' }]);
      expect(result.count).toBe(2);
      expect(result.ids).toEqual(['a', 'b']);
    });
  });

  describe('recall', () => {
    it('sends POST /v1/recall', async () => {
      const f = mockFetch([{
        status: 200,
        body: {
          memories: [{ id: 'r1', content: 'test', similarity: 0.95, metadata: {}, importance: 0.8, memory_type: 'preference', namespace: 'default', created_at: '2025-01-01', access_count: 1 }],
          query_tokens: 5,
        },
      }]);
      const client = createClient(f);
      const result = await client.recall({ query: 'test', limit: 5 });
      expect(result.memories).toHaveLength(1);
      expect(result.memories[0]?.similarity).toBe(0.95);
    });
  });

  describe('list', () => {
    it('sends GET /v1/memories with query params', async () => {
      const f = mockFetch([{ status: 200, body: { memories: [], total: 0, limit: 20, offset: 0 } }]);
      const client = createClient(f);
      const result = await client.list({ limit: 10, namespace: 'test' });
      expect(result.total).toBe(0);
      expect(f).toHaveBeenCalledWith(
        expect.stringContaining('limit=10'),
        expect.anything(),
      );
    });
  });

  describe('get', () => {
    it('retrieves a single memory', async () => {
      const mem = { id: 'mem-1', user_id: 'u1', namespace: 'default', content: 'hello', embedding_model: 'e', metadata: {}, importance: 0.5, memory_type: 'general', session_id: null, agent_id: null, created_at: '', updated_at: '', accessed_at: '', access_count: 0, deleted_at: null, expires_at: null, pinned: false, immutable: false };
      const f = mockFetch([{ status: 200, body: mem }]);
      const client = createClient(f);
      const result = await client.get('mem-1');
      expect(result.id).toBe('mem-1');
    });
  });

  describe('exists', () => {
    it('returns true when memory exists (200)', async () => {
      const mem = { id: 'mem-1', user_id: 'u1', namespace: 'default', content: 'hello', embedding_model: 'e', metadata: {}, importance: 0.5, memory_type: 'general', session_id: null, agent_id: null, created_at: '', updated_at: '', accessed_at: '', access_count: 0, deleted_at: null, expires_at: null, pinned: false, immutable: false };
      const f = mockFetch([{ status: 200, body: mem }]);
      const client = createClient(f);
      const result = await client.exists('mem-1');
      expect(result).toBe(true);
    });

    it('returns false when memory does not exist (404)', async () => {
      const f = mockFetch([{ status: 404, ok: false, body: { error: { code: 'NOT_FOUND', message: 'Memory not found' } } }]);
      const client = createClient(f);
      const result = await client.exists('nonexistent');
      expect(result).toBe(false);
    });

    it('throws on other errors (e.g. 500)', async () => {
      const f = mockFetch([{ status: 500, ok: false, body: { error: { code: 'INTERNAL', message: 'Server error' } } }]);
      const client = createClient(f);
      await expect(client.exists('mem-1')).rejects.toThrow();
    });

    it('throws on empty id', async () => {
      const f = mockFetch([]);
      const client = createClient(f);
      await expect(client.exists('')).rejects.toThrow('id must be a non-empty string');
    });
  });

  describe('update', () => {
    it('sends PATCH /v1/memories/:id', async () => {
      const mem = { id: 'mem-1', user_id: 'u1', namespace: 'default', content: 'updated', embedding_model: 'e', metadata: {}, importance: 0.9, memory_type: 'general', session_id: null, agent_id: null, created_at: '', updated_at: '', accessed_at: '', access_count: 0, deleted_at: null, expires_at: null, pinned: false, immutable: false };
      const f = mockFetch([{ status: 200, body: mem }]);
      const client = createClient(f);
      const result = await client.update('mem-1', { content: 'updated', importance: 0.9 });
      expect(result.content).toBe('updated');
    });
  });

  describe('delete', () => {
    it('sends DELETE and returns result', async () => {
      const f = mockFetch([{ status: 200, body: { deleted: true, id: 'mem-1' } }]);
      const client = createClient(f);
      const result = await client.delete('mem-1');
      expect(result.deleted).toBe(true);
    });
  });

  describe('ingest', () => {
    it('ingests messages', async () => {
      const f = mockFetch([{ status: 201, body: { memory_ids: ['a'], facts_extracted: 2, facts_stored: 1, facts_deduplicated: 1, relations_created: 0, tokens_used: 100 } }]);
      const client = createClient(f);
      const result = await client.ingest({ messages: [{ role: 'user', content: 'I like Python' }] });
      expect(result.facts_extracted).toBe(2);
    });
  });

  describe('extract', () => {
    it('extracts facts', async () => {
      const f = mockFetch([{ status: 201, body: { memory_ids: ['a'], facts_extracted: 1, facts_stored: 1, facts_deduplicated: 0, tokens_used: 50 } }]);
      const client = createClient(f);
      const result = await client.extract({ messages: [{ role: 'user', content: 'I use vim' }] });
      expect(result.facts_stored).toBe(1);
    });
  });

  describe('consolidate', () => {
    it('sends POST /v1/memories/consolidate', async () => {
      const f = mockFetch([{ status: 200, body: { clusters_found: 2, memories_merged: 3, memories_created: 0, clusters: [{ memory_ids: ['a', 'b'], similarity: 0.92, merged_into: 'c' }] } }]);
      const client = createClient(f);
      const result = await client.consolidate({ min_similarity: 0.9 });
      expect(result.clusters_found).toBe(2);
      expect(result.memories_merged).toBe(3);
      expect(result.clusters[0]?.merged_into).toBe('c');
    });
  });

  describe('relations', () => {
    it('creates a relation', async () => {
      const f = mockFetch([{ status: 201, body: { id: 'rel-1', source_id: 'm1', target_id: 'm2', relation_type: 'related_to', metadata: {}, created_at: '2025-01-01T00:00:00Z' } }]);
      const client = createClient(f);
      const result = await client.createRelation('m1', { target_id: 'm2', relation_type: 'related_to' });
      expect(result.id).toBe('rel-1');
      expect(result.source_id).toBe('m1');
      expect(result.relation_type).toBe('related_to');
    });

    it('lists relations', async () => {
      const f = mockFetch([{ status: 200, body: { relations: [] } }]);
      const client = createClient(f);
      const result = await client.listRelations('m1');
      expect(result.relations).toEqual([]);
    });

    it('deletes a relation', async () => {
      const f = mockFetch([{ status: 200, body: { deleted: true, id: 'rel-1' } }]);
      const client = createClient(f);
      const result = await client.deleteRelation('m1', 'rel-1');
      expect(result.deleted).toBe(true);
    });
  });

  describe('status', () => {
    it('returns free tier status', async () => {
      const f = mockFetch([{ status: 200, body: { wallet: '0x', free_tier_remaining: 950, free_tier_total: 1000, free_tier_used: 50 } }]);
      const client = createClient(f);
      const result = await client.status();
      expect(result.free_tier_remaining).toBe(950);
    });
  });

  describe('suggested', () => {
    it('returns suggestions', async () => {
      const f = mockFetch([{ status: 200, body: { suggested: [], categories: {}, total: 0 } }]);
      const client = createClient(f);
      const result = await client.suggested({ category: 'stale' });
      expect(result.total).toBe(0);
    });
  });
});

describe('Error handling', () => {
  it('throws AuthenticationError on 401', async () => {
    const f = mockFetch([{ status: 401, ok: false, body: { error: { code: 'AUTH_ERROR', message: 'Invalid wallet' } } }]);
    const client = createClient(f);
    await expect(client.status()).rejects.toThrow(AuthenticationError);
  });

  it('throws PaymentRequiredError on 402', async () => {
    const f = mockFetch([{ status: 402, ok: false, body: { error: { code: 'PAYMENT_REQUIRED', message: 'Free tier exhausted' } } }]);
    const client = createClient(f);
    await expect(client.store({ content: 'x' })).rejects.toThrow(PaymentRequiredError);
  });

  it('throws ForbiddenError on 403', async () => {
    const f = mockFetch([{ status: 403, ok: false, body: { error: { code: 'FORBIDDEN', message: 'No access' } } }]);
    const client = createClient(f);
    await expect(client.get('x')).rejects.toThrow(ForbiddenError);
  });

  it('throws NotFoundError on 404', async () => {
    const f = mockFetch([{ status: 404, ok: false, body: { error: { code: 'NOT_FOUND', message: 'Memory not found' } } }]);
    const client = createClient(f);
    await expect(client.get('nonexistent')).rejects.toThrow(NotFoundError);
  });

  it('throws ValidationError on 422', async () => {
    const f = mockFetch([{ status: 422, ok: false, body: { error: { code: 'VALIDATION_ERROR', message: 'Content too long', details: { max: 8192 } } } }]);
    const client = createClient(f);
    try {
      await client.store({ content: 'valid content' });
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).details).toEqual({ max: 8192 });
    }
  });

  it('includes suggestion in error message', async () => {
    const f = mockFetch([{ status: 404, ok: false, body: { error: { code: 'MEMORY_NOT_FOUND', message: 'Memory not found' } } }]);
    const client = createClient(f);
    try {
      await client.get('x');
      throw new Error('should have thrown');
    } catch (e) {
      const err = e as NotFoundError;
      expect(err.code).toBe('MEMORY_NOT_FOUND');
      expect(err.message).toContain('Memory not found');
      expect(err.suggestion).toBeDefined();
      expect(err.suggestion).toContain('client.list()');
      expect(err.toString()).toContain('→');
    }
  });

  it('provides actionable suggestion for known error codes', async () => {
    const f = mockFetch([{ status: 402, ok: false, body: { error: { code: 'FREE_TIER_EXHAUSTED', message: 'Free tier used up' } } }]);
    const client = createClient(f);
    try {
      await client.store({ content: 'test' });
      throw new Error('should have thrown');
    } catch (e) {
      const err = e as PaymentRequiredError;
      expect(err.suggestion).toContain('USDC');
      expect(err.suggestion).toContain('docs.memoclaw.com');
    }
  });

  it('falls back to status-based suggestion for unknown codes', async () => {
    const f = mockFetch([{ status: 429, ok: false, body: { error: { code: 'UNKNOWN_THROTTLE', message: 'Slow down' } } }]);
    const client = createClient(f);
    try {
      await client.recall({ query: 'test' });
      throw new Error('should have thrown');
    } catch (e) {
      const err = e as MemoClawError;
      expect(err.suggestion).toBeDefined();
      expect(err.suggestion).toContain('backoff');
    }
  });

  it('retries on 429 then succeeds', async () => {
    const f = mockFetch([
      { status: 429, ok: false, body: { error: { code: 'RATE_LIMITED', message: 'Too fast' } } },
      { status: 200, body: { memories: [], query_tokens: 0 } },
    ]);
    const client = createClient(f);
    const result = await client.recall({ query: 'test' });
    expect(result.query_tokens).toBe(0);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('honors Retry-After header on 429', async () => {
    const f = mockFetch([
      { status: 429, ok: false, body: { error: { code: 'RATE_LIMITED', message: 'Too fast' } }, headers: { 'retry-after': '1' } },
      { status: 200, body: { memories: [], query_tokens: 0 } },
    ]);
    const client = createClient(f);
    const start = Date.now();
    const result = await client.recall({ query: 'test' });
    const elapsed = Date.now() - start;
    expect(result.query_tokens).toBe(0);
    expect(f).toHaveBeenCalledTimes(2);
    // Should have waited ~1000ms (Retry-After: 1 second)
    expect(elapsed).toBeGreaterThanOrEqual(900);
  });

  it('retries on 500 then throws InternalServerError', async () => {
    const f = mockFetch([
      { status: 500, ok: false, body: { error: { code: 'INTERNAL', message: 'DB down' } } },
      { status: 500, ok: false, body: { error: { code: 'INTERNAL', message: 'DB down' } } },
    ]);
    const client = createClient(f);
    await expect(client.store({ content: 'x' })).rejects.toThrow(InternalServerError);
  });

  it('retries on network error', async () => {
    let calls = 0;
    const f = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new Error('network error');
      return { ok: true, status: 200, json: async () => ({ memories: [], total: 0, limit: 20, offset: 0 }) } as Response;
    });
    const client = createClient(f);
    const result = await client.list();
    expect(result.total).toBe(0);
    expect(calls).toBe(2);
  });
});

describe('Hooks', () => {
  it('calls beforeRequest hook', async () => {
    const f = mockFetch([{ status: 200, body: { wallet: '0x', free_tier_remaining: 1000, free_tier_total: 1000, free_tier_used: 0 } }]);
    const hook = vi.fn();
    const client = createClient(f).onBeforeRequest(hook);
    await client.status();
    expect(hook).toHaveBeenCalledWith('GET', '/v1/free-tier/status', undefined);
  });

  it('calls afterResponse hook', async () => {
    const f = mockFetch([{ status: 200, body: { wallet: '0x', free_tier_remaining: 1000, free_tier_total: 1000, free_tier_used: 0 } }]);
    const hook = vi.fn();
    const client = createClient(f).onAfterResponse(hook);
    await client.status();
    expect(hook).toHaveBeenCalledWith('GET', '/v1/free-tier/status', expect.objectContaining({ wallet: '0x' }));
  });

  it('calls onError hook on failure', async () => {
    const f = mockFetch([{ status: 404, ok: false, body: { error: { code: 'NOT_FOUND', message: 'nope' } } }]);
    const hook = vi.fn();
    const client = createClient(f).onError(hook);
    await expect(client.get('x')).rejects.toThrow();
    expect(hook).toHaveBeenCalledWith('GET', '/v1/memories/x', expect.any(NotFoundError));
  });

  it('beforeRequest can modify body', async () => {
    const f = mockFetch([{ status: 201, body: { id: 'x', stored: true, deduplicated: false, tokens_used: 1 } }]);
    const client = createClient(f).onBeforeRequest((_method, _path, body) => {
      return { ...(body as Record<string, unknown>), namespace: 'injected' };
    });
    await client.store({ content: 'test' });
    const sentBody = JSON.parse((f as ReturnType<typeof vi.fn>).mock.calls[0]![1].body);
    expect(sentBody.namespace).toBe('injected');
  });
});

describe('listAll async iterator', () => {
  it('paginates through all results', async () => {
    const page1 = { memories: [{ id: '1' }, { id: '2' }], total: 3, limit: 2, offset: 0 };
    const page2 = { memories: [{ id: '3' }], total: 3, limit: 2, offset: 2 };
    const f = mockFetch([
      { status: 200, body: page1 },
      { status: 200, body: page2 },
    ]);
    const client = createClient(f);
    const ids: string[] = [];
    for await (const mem of client.listAll({ batchSize: 2 })) {
      ids.push(mem.id);
    }
    expect(ids).toEqual(['1', '2', '3']);
  });

  it('handles empty results', async () => {
    const f = mockFetch([{ status: 200, body: { memories: [], total: 0, limit: 50, offset: 0 } }]);
    const client = createClient(f);
    const ids: string[] = [];
    for await (const mem of client.listAll()) {
      ids.push(mem.id);
    }
    expect(ids).toEqual([]);
  });
});

describe('getMemoryGraph', () => {
  it('calls server-side graph endpoint', async () => {
    const graphResponse = {
      root: { id: 'm1', content: 'root memory', importance: 0.8 },
      nodes: [
        { id: 'm1', content: 'root memory', importance: 0.8 },
        { id: 'm2', content: 'related memory', importance: 0.5 },
      ],
      edges: [
        { source_id: 'm1', target_id: 'm2', relation_type: 'related_to' },
      ],
      depth: 2,
    };
    const f = mockFetch([{ status: 200, body: graphResponse }]);
    const client = createClient(f);
    const graph = await client.getMemoryGraph('m1', { depth: 2 });
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
    expect(graph.root.id).toBe('m1');
    expect(graph.depth).toBe(2);
    expect(f).toHaveBeenCalledWith(
      expect.stringContaining('/v1/memories/m1/graph'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('passes query params', async () => {
    const graphResponse = { root: { id: 'm1', content: 'x', importance: 0.5 }, nodes: [], edges: [], depth: 1 };
    const f = mockFetch([{ status: 200, body: graphResponse }]);
    const client = createClient(f);
    await client.getMemoryGraph('m1', { depth: 3, limit: 100, relation_types: ['supports', 'contradicts'] });
    const url = (f as any).mock.calls[0][0] as string;
    expect(url).toContain('depth=3');
    expect(url).toContain('limit=100');
    expect(url).toContain('relation_types=supports%2Ccontradicts');
  });

  it('throws on empty memoryId', async () => {
    const client = createClient(vi.fn());
    await expect(client.getMemoryGraph('')).rejects.toThrow('non-empty string');
  });
});

describe('requestId', () => {
  it('attaches x-request-id to error on non-2xx response', async () => {
    const f = mockFetch([{
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: 'Memory not found' } },
      headers: { 'x-request-id': 'req-abc-123' },
    }]);
    const client = createClient(f);
    try {
      await client.get('nonexistent');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(MemoClawError);
      const e = err as import('../errors.js').MemoClawError;
      expect(e.requestId).toBe('req-abc-123');
      expect(e.toString()).toContain('req-abc-123');
    }
  });

  it('requestId is undefined when header is absent', async () => {
    const f = mockFetch([{
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: 'Memory not found' } },
    }]);
    const client = createClient(f);
    try {
      await client.get('nonexistent');
      expect.unreachable('should have thrown');
    } catch (err) {
      const e = err as import('../errors.js').MemoClawError;
      expect(e.requestId).toBeUndefined();
    }
  });
});

describe('debug logging', () => {
  it('calls logger.debug on request and response', async () => {
    const debugFn = vi.fn();
    const f = mockFetch([{ status: 200, body: { wallet: '0x', free_tier_remaining: 10, free_tier_total: 100, free_tier_used: 90 } }]);
    const client = new MemoClawClient({
      privateKey: TEST_PRIVATE_KEY,
      baseUrl: BASE_URL,
      fetch: f,
      logger: { debug: debugFn },
    });
    await client.status();
    // Should have at least a request log and a response log
    expect(debugFn).toHaveBeenCalled();
    const calls = debugFn.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((c: string) => c.includes('GET') && c.includes('/v1/free-tier/status'))).toBe(true);
    expect(calls.some((c: string) => c.includes('200'))).toBe(true);
  });

  it('does not log when debug is not set', async () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const f = mockFetch([{ status: 200, body: { wallet: '0x', free_tier_remaining: 10, free_tier_total: 100, free_tier_used: 90 } }]);
    const client = createClient(f);
    await client.status();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('wallet-only mode', () => {
  function createWalletOnlyClient(fetchFn: typeof globalThis.fetch) {
    const orig = process.env.MEMOCLAW_PRIVATE_KEY;
    delete process.env.MEMOCLAW_PRIVATE_KEY;
    try {
      return new MemoClawClient({
        wallet: '0x1234567890abcdef1234567890abcdef12345678',
        baseUrl: BASE_URL,
        fetch: fetchFn,
      });
    } finally {
      if (orig !== undefined) process.env.MEMOCLAW_PRIVATE_KEY = orig;
    }
  }

  it('free endpoints work with wallet-only auth', async () => {
    const f = mockFetch([{ status: 200, body: { memories: [], total: 0, limit: 20, offset: 0 } }]);
    const client = createWalletOnlyClient(f);
    const result = await client.list();
    expect(result.total).toBe(0);
    // Should send plain wallet address as auth header
    expect(f).toHaveBeenCalledWith(
      expect.stringContaining('/v1/memories'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-wallet-auth': '0x1234567890abcdef1234567890abcdef12345678',
        }),
      }),
    );
  });

  it('status() works with wallet-only auth', async () => {
    const f = mockFetch([{ status: 200, body: { wallet: '0x', free_tier_remaining: 50, free_tier_total: 100, free_tier_used: 50 } }]);
    const client = createWalletOnlyClient(f);
    const result = await client.status();
    expect(result.free_tier_remaining).toBe(50);
  });

  it('store() throws in wallet-only mode', async () => {
    const client = createWalletOnlyClient(mockFetch([]));
    await expect(client.store({ content: 'test' })).rejects.toThrow('store() requires a private key');
  });

  it('recall() throws in wallet-only mode', async () => {
    const client = createWalletOnlyClient(mockFetch([]));
    await expect(client.recall({ query: 'test' })).rejects.toThrow('recall() requires a private key');
  });

  it('storeBatch() throws in wallet-only mode', async () => {
    const client = createWalletOnlyClient(mockFetch([]));
    await expect(client.storeBatch([{ content: 'a' }])).rejects.toThrow('storeBatch() requires a private key');
  });

  it('update() throws in wallet-only mode', async () => {
    const client = createWalletOnlyClient(mockFetch([]));
    await expect(client.update('id', { content: 'new' })).rejects.toThrow('update() requires a private key');
  });

  it('ingest() throws in wallet-only mode', async () => {
    const client = createWalletOnlyClient(mockFetch([]));
    await expect(client.ingest({ text: 'hello' })).rejects.toThrow('ingest() requires a private key');
  });

  it('get() works in wallet-only mode (free endpoint)', async () => {
    const f = mockFetch([{ status: 200, body: { id: 'mem-1', content: 'test', importance: 0.5, memory_type: 'general', namespace: 'default', created_at: '2025-01-01', metadata: {} } }]);
    const client = createWalletOnlyClient(f);
    const result = await client.get('mem-1');
    expect(result.id).toBe('mem-1');
  });

  it('delete() works in wallet-only mode (free endpoint)', async () => {
    const f = mockFetch([{ status: 200, body: { deleted: true } }]);
    const client = createWalletOnlyClient(f);
    const result = await client.delete('mem-1');
    expect(result.deleted).toBe(true);
  });
});

describe('Content length validation', () => {
  it('store() rejects content exceeding 8192 chars', async () => {
    const f = mockFetch([]);
    const client = createClient(f);
    await expect(client.store({ content: 'x'.repeat(8193) })).rejects.toThrow('8192 character limit');
  });

  it('store() accepts content at exactly 8192 chars', async () => {
    const f = mockFetch([{ status: 201, body: { id: 'mem-1', stored: true, deduplicated: false, tokens_used: 50 } }]);
    const client = createClient(f);
    const result = await client.store({ content: 'x'.repeat(8192) });
    expect(result.id).toBe('mem-1');
  });

  it('storeBatch() rejects items with content exceeding 8192 chars', async () => {
    const f = mockFetch([]);
    const client = createClient(f);
    await expect(client.storeBatch([{ content: 'x'.repeat(8193) }])).rejects.toThrow('8192 character limit');
  });

  it('update() rejects content exceeding 8192 chars', async () => {
    const f = mockFetch([]);
    const client = createClient(f);
    await expect(client.update('mem-1', { content: 'x'.repeat(8193) })).rejects.toThrow('8192 character limit');
  });

  it('update() allows updates without content', async () => {
    const f = mockFetch([{ status: 200, body: { id: 'mem-1', content: 'test', importance: 0.9, memory_type: 'general', namespace: 'default', created_at: '2025-01-01', metadata: {} } }]);
    const client = createClient(f);
    const result = await client.update('mem-1', { importance: 0.9 });
    expect(result.id).toBe('mem-1');
  });
});

describe('Importance validation', () => {
  it('store() rejects importance > 1.0', async () => {
    const f = mockFetch([]);
    const client = createClient(f);
    await expect(client.store({ content: 'test', importance: 1.5 })).rejects.toThrow('importance must be between');
  });

  it('store() rejects negative importance', async () => {
    const f = mockFetch([]);
    const client = createClient(f);
    await expect(client.store({ content: 'test', importance: -0.1 })).rejects.toThrow('importance must be between');
  });

  it('store() accepts importance at boundaries', async () => {
    const f = mockFetch([{ status: 201, body: { id: 'mem-1', stored: true, deduplicated: false, tokens_used: 50 } }]);
    const client = createClient(f);
    const result = await client.store({ content: 'test', importance: 0.0 });
    expect(result.id).toBe('mem-1');
  });

  it('update() rejects importance > 1.0', async () => {
    const f = mockFetch([]);
    const client = createClient(f);
    await expect(client.update('mem-1', { importance: 2.0 })).rejects.toThrow('importance must be between');
  });
});
