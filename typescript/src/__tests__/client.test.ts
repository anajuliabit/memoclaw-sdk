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

function mockFetch(responses: Array<{ status: number; body?: unknown; ok?: boolean }>): typeof globalThis.fetch {
  let callIndex = 0;
  return vi.fn(async () => {
    const resp = responses[callIndex] ?? responses[responses.length - 1]!;
    callIndex++;
    return {
      ok: resp.ok ?? (resp.status >= 200 && resp.status < 300),
      status: resp.status,
      json: async () => resp.body,
    } as Response;
  });
}

function createClient(fetchFn: typeof globalThis.fetch) {
  return new MemoClawClient({
    wallet: '0xTestWallet',
    baseUrl: BASE_URL,
    fetch: fetchFn,
    maxRetries: 1,
    retryDelay: 1,
  });
}

describe('MemoClawClient', () => {
  describe('constructor', () => {
    it('throws if wallet is missing', () => {
      expect(() => new MemoClawClient({ wallet: '' })).toThrow('wallet is required');
    });

    it('strips trailing slashes from baseUrl', () => {
      const f = mockFetch([{ status: 200, body: { wallet: '0x', free_tier_remaining: 10, free_tier_total: 100, free_tier_used: 90 } }]);
      const client = new MemoClawClient({ wallet: '0xTest', baseUrl: 'https://custom.api.com///', fetch: f });
      client.status();
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
      const mem = { id: 'mem-1', user_id: 'u1', namespace: 'default', content: 'hello', embedding_model: 'e', metadata: {}, importance: 0.5, memory_type: 'general', session_id: null, agent_id: null, created_at: '', updated_at: '', accessed_at: '', access_count: 0, deleted_at: null, expires_at: null, pinned: false };
      const f = mockFetch([{ status: 200, body: mem }]);
      const client = createClient(f);
      const result = await client.get('mem-1');
      expect(result.id).toBe('mem-1');
    });
  });

  describe('update', () => {
    it('sends PATCH /v1/memories/:id', async () => {
      const mem = { id: 'mem-1', user_id: 'u1', namespace: 'default', content: 'updated', embedding_model: 'e', metadata: {}, importance: 0.9, memory_type: 'general', session_id: null, agent_id: null, created_at: '', updated_at: '', accessed_at: '', access_count: 0, deleted_at: null, expires_at: null, pinned: false };
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
      const f = mockFetch([{ status: 200, body: { clusters: 2, merged: 3, tokens_used: 100, dry_run: false } }]);
      const client = createClient(f);
      const result = await client.consolidate({ min_similarity: 0.9 });
      expect(result.clusters).toBe(2);
    });
  });

  describe('relations', () => {
    it('creates a relation', async () => {
      const f = mockFetch([{ status: 201, body: { id: 'rel-1', created: true } }]);
      const client = createClient(f);
      const result = await client.createRelation('m1', { target_id: 'm2', relation_type: 'related_to' });
      expect(result.id).toBe('rel-1');
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
      await client.store({ content: 'x'.repeat(10000) });
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).details).toEqual({ max: 8192 });
    }
  });

  it('includes suggestion in error message', async () => {
    const f = mockFetch([{ status: 404, ok: false, body: { error: { code: 'NOT_FOUND', message: 'Memory not found' } } }]);
    const client = createClient(f);
    try {
      await client.get('x');
    } catch (e) {
      expect((e as NotFoundError).code).toBe('NOT_FOUND');
      expect((e as NotFoundError).message).toContain('Memory not found');
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
  it('traverses 1 hop', async () => {
    const f = mockFetch([
      // m1's relations
      { status: 200, body: { relations: [{ id: 'r1', relation_type: 'related_to', direction: 'outgoing', memory: { id: 'm2', content: 'related', importance: 0.5, memory_type: 'general', namespace: 'default' }, metadata: {}, created_at: '' }] } },
      // m2's relations (fetched in 2nd hop iteration, but depth=1 means we process frontier[m2])
      { status: 200, body: { relations: [] } },
    ]);
    const client = createClient(f);
    const graph = await client.getMemoryGraph('m1', 2);
    expect(graph.size).toBe(2);
    expect(graph.has('m1')).toBe(true);
    expect(graph.has('m2')).toBe(true);
  });
});
