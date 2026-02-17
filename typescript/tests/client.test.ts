import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoClawClient } from '../src/client.js';
import {
  MemoClawError,
  AuthenticationError,
  NotFoundError,
  ValidationError,
  RateLimitError,
  InternalServerError,
} from '../src/errors.js';

const WALLET = '0x1234567890abcdef1234567890abcdef12345678';

function mockFetch(responses: Array<{ status: number; body: unknown; ok?: boolean }>) {
  let callIndex = 0;
  return vi.fn(async () => {
    const resp = responses[callIndex++] ?? responses[responses.length - 1]!;
    return {
      ok: resp.ok ?? (resp.status >= 200 && resp.status < 300),
      status: resp.status,
      json: async () => resp.body,
      headers: new Headers(),
    } as unknown as Response;
  });
}

function createClient(fetch: typeof globalThis.fetch, opts?: Partial<{ maxRetries: number; retryDelay: number }>) {
  return new MemoClawClient({
    wallet: WALLET,
    fetch,
    maxRetries: opts?.maxRetries ?? 0,
    retryDelay: opts?.retryDelay ?? 1,
  });
}

describe('MemoClawClient constructor', () => {
  it('throws if wallet is missing', () => {
    expect(() => new MemoClawClient({ wallet: '' })).toThrow('wallet is required');
  });

  it('strips trailing slashes from baseUrl', () => {
    const f = mockFetch([{ status: 200, body: { wallet: WALLET, free_tier_remaining: 100, free_tier_total: 100, free_tier_used: 0 } }]);
    const client = new MemoClawClient({ wallet: WALLET, baseUrl: 'https://custom.api.com///', fetch: f });
    client.status();
    expect(f).toHaveBeenCalledWith(expect.stringContaining('https://custom.api.com/v1/'), expect.anything());
  });
});

describe('store', () => {
  it('stores a memory and returns result', async () => {
    const f = mockFetch([{ status: 201, body: { id: 'mem-1', stored: true, deduplicated: false, tokens_used: 10 } }]);
    const client = createClient(f);
    const result = await client.store({ content: 'hello world' });
    expect(result.id).toBe('mem-1');
    expect(result.stored).toBe(true);
  });

  it('throws on empty content', async () => {
    const client = createClient(mockFetch([]));
    await expect(client.store({ content: '' })).rejects.toThrow('content must be a non-empty string');
    await expect(client.store({ content: '   ' })).rejects.toThrow('content must be a non-empty string');
  });

  it('sends correct headers', async () => {
    const f = mockFetch([{ status: 201, body: { id: 'mem-1', stored: true, deduplicated: false, tokens_used: 10 } }]);
    const client = createClient(f);
    await client.store({ content: 'test' });
    const [, init] = f.mock.calls[0]!;
    expect(init.headers['X-Wallet']).toBe(WALLET);
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.method).toBe('POST');
  });
});

describe('storeBatch', () => {
  it('stores batch successfully', async () => {
    const f = mockFetch([{ status: 201, body: { ids: ['m1', 'm2'], stored: true, count: 2, deduplicated_count: 0, tokens_used: 20 } }]);
    const client = createClient(f);
    const result = await client.storeBatch([{ content: 'a' }, { content: 'b' }]);
    expect(result.ids).toHaveLength(2);
  });

  it('throws on empty array', async () => {
    const client = createClient(mockFetch([]));
    await expect(client.storeBatch([])).rejects.toThrow('memories array must not be empty');
  });

  it('throws when exceeding max batch size', async () => {
    const client = createClient(mockFetch([]));
    const memories = Array.from({ length: 101 }, (_, i) => ({ content: `mem ${i}` }));
    await expect(client.storeBatch(memories)).rejects.toThrow('exceeds maximum of 100');
  });

  it('throws on empty content in batch', async () => {
    const client = createClient(mockFetch([]));
    await expect(client.storeBatch([{ content: 'ok' }, { content: '' }])).rejects.toThrow('non-empty content');
  });
});

describe('recall', () => {
  it('recalls memories', async () => {
    const f = mockFetch([{
      status: 200,
      body: {
        memories: [{ id: 'm1', content: 'test', similarity: 0.95, metadata: {}, importance: 0.8, memory_type: 'general', namespace: 'default', session_id: null, agent_id: null, created_at: '2025-01-01', access_count: 1, pinned: false, immutable: false }],
        query_tokens: 5,
      },
    }]);
    const client = createClient(f);
    const result = await client.recall({ query: 'test' });
    expect(result.memories).toHaveLength(1);
    expect(result.memories[0]!.similarity).toBe(0.95);
  });

  it('throws on empty query', async () => {
    const client = createClient(mockFetch([]));
    await expect(client.recall({ query: '' })).rejects.toThrow('query must be a non-empty string');
  });
});

describe('list', () => {
  it('lists memories with pagination params', async () => {
    const f = mockFetch([{ status: 200, body: { memories: [], total: 0, limit: 20, offset: 0 } }]);
    const client = createClient(f);
    const result = await client.list({ limit: 20, offset: 0, namespace: 'test' });
    expect(result.total).toBe(0);
    const url = f.mock.calls[0]![0] as string;
    expect(url).toContain('limit=20');
    expect(url).toContain('namespace=test');
  });
});

describe('get', () => {
  it('gets a memory by id', async () => {
    const mem = { id: 'mem-1', user_id: 'u1', namespace: 'default', content: 'test', embedding_model: 'text-embedding-3-small', metadata: {}, importance: 0.5, memory_type: 'general', session_id: null, agent_id: null, created_at: '2025-01-01', updated_at: '2025-01-01', accessed_at: '2025-01-01', access_count: 0, deleted_at: null, expires_at: null, pinned: false, immutable: false };
    const f = mockFetch([{ status: 200, body: mem }]);
    const client = createClient(f);
    const result = await client.get('mem-1');
    expect(result.id).toBe('mem-1');
  });

  it('throws on empty id', async () => {
    const client = createClient(mockFetch([]));
    await expect(client.get('')).rejects.toThrow('id must be a non-empty string');
  });

  it('encodes special characters in id', async () => {
    const f = mockFetch([{ status: 200, body: { id: 'a/b' } }]);
    const client = createClient(f);
    await client.get('a/b');
    const url = f.mock.calls[0]![0] as string;
    expect(url).toContain('a%2Fb');
  });
});

describe('delete', () => {
  it('deletes a memory', async () => {
    const f = mockFetch([{ status: 200, body: { deleted: true, id: 'mem-1' } }]);
    const client = createClient(f);
    const result = await client.delete('mem-1');
    expect(result.deleted).toBe(true);
  });
});

describe('update', () => {
  it('updates a memory', async () => {
    const mem = { id: 'mem-1', user_id: 'u1', namespace: 'default', content: 'updated', embedding_model: 'text-embedding-3-small', metadata: {}, importance: 0.9, memory_type: 'general', session_id: null, agent_id: null, created_at: '2025-01-01', updated_at: '2025-06-01', accessed_at: '2025-01-01', access_count: 1, deleted_at: null, expires_at: null, pinned: false, immutable: false };
    const f = mockFetch([{ status: 200, body: mem }]);
    const client = createClient(f);
    const result = await client.update('mem-1', { content: 'updated', importance: 0.9 });
    expect(result.content).toBe('updated');
  });
});

describe('ingest', () => {
  it('ingests messages', async () => {
    const f = mockFetch([{ status: 201, body: { memory_ids: ['a'], facts_extracted: 1, facts_stored: 1, facts_deduplicated: 0, relations_created: 0, tokens_used: 50 } }]);
    const client = createClient(f);
    const result = await client.ingest({ messages: [{ role: 'user', content: 'I like cats' }] });
    expect(result.facts_extracted).toBe(1);
  });

  it('throws when neither messages nor text provided', async () => {
    const client = createClient(mockFetch([]));
    await expect(client.ingest({})).rejects.toThrow('Either messages or text must be provided');
  });
});

describe('extract', () => {
  it('throws on empty messages', async () => {
    const client = createClient(mockFetch([]));
    await expect(client.extract({ messages: [] })).rejects.toThrow('messages must be a non-empty array');
  });
});

describe('relations', () => {
  it('creates a relation', async () => {
    const f = mockFetch([{ status: 201, body: { id: 'rel-1', created: true } }]);
    const client = createClient(f);
    const result = await client.createRelation('m1', { target_id: 'm2', relation_type: 'related_to' });
    expect(result.id).toBe('rel-1');
  });

  it('validates memoryId for createRelation', async () => {
    const client = createClient(mockFetch([]));
    await expect(client.createRelation('', { target_id: 'm2', relation_type: 'related_to' })).rejects.toThrow('memoryId');
  });

  it('validates target_id for createRelation', async () => {
    const client = createClient(mockFetch([]));
    await expect(client.createRelation('m1', { target_id: '', relation_type: 'related_to' })).rejects.toThrow('target_id');
  });

  it('lists relations', async () => {
    const f = mockFetch([{ status: 200, body: { relations: [] } }]);
    const client = createClient(f);
    const result = await client.listRelations('m1');
    expect(result.relations).toHaveLength(0);
  });

  it('deletes a relation', async () => {
    const f = mockFetch([{ status: 200, body: { deleted: true, id: 'rel-1' } }]);
    const client = createClient(f);
    const result = await client.deleteRelation('m1', 'rel-1');
    expect(result.deleted).toBe(true);
  });
});

describe('status', () => {
  it('gets free tier status', async () => {
    const f = mockFetch([{ status: 200, body: { wallet: WALLET, free_tier_remaining: 950, free_tier_total: 1000, free_tier_used: 50 } }]);
    const client = createClient(f);
    const result = await client.status();
    expect(result.free_tier_remaining).toBe(950);
  });
});

describe('suggested', () => {
  it('gets suggestions with params', async () => {
    const f = mockFetch([{ status: 200, body: { suggested: [], categories: {}, total: 0 } }]);
    const client = createClient(f);
    const result = await client.suggested({ category: 'stale', limit: 5 });
    expect(result.total).toBe(0);
    const url = f.mock.calls[0]![0] as string;
    expect(url).toContain('category=stale');
  });
});

describe('consolidate', () => {
  it('consolidates memories', async () => {
    const f = mockFetch([{ status: 200, body: { clusters: 1, merged: 2, tokens_used: 100, dry_run: false } }]);
    const client = createClient(f);
    const result = await client.consolidate({ min_similarity: 0.9 });
    expect(result.clusters).toBe(1);
  });
});

describe('error handling', () => {
  it('throws NotFoundError on 404', async () => {
    const f = mockFetch([{ status: 404, ok: false, body: { error: { code: 'NOT_FOUND', message: 'Memory not found' } } }]);
    const client = createClient(f);
    try {
      await client.get('nonexistent');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(NotFoundError);
      expect((e as NotFoundError).status).toBe(404);
      expect((e as NotFoundError).code).toBe('NOT_FOUND');
    }
  });

  it('throws AuthenticationError on 401', async () => {
    const f = mockFetch([{ status: 401, ok: false, body: { error: { code: 'AUTH_ERROR', message: 'Invalid' } } }]);
    const client = createClient(f);
    await expect(client.status()).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('throws ValidationError on 422', async () => {
    const f = mockFetch([{ status: 422, ok: false, body: { error: { code: 'VALIDATION_ERROR', message: 'Bad input', details: { field: 'content' } } } }]);
    const client = createClient(f);
    try {
      await client.store({ content: 'x'.repeat(10000) });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).details).toEqual({ field: 'content' });
    }
  });

  it('throws RateLimitError on 429', async () => {
    const f = mockFetch([{ status: 429, ok: false, body: { error: { code: 'RATE_LIMITED', message: 'Too many requests' } } }]);
    const client = createClient(f);
    await expect(client.status()).rejects.toBeInstanceOf(RateLimitError);
  });

  it('throws InternalServerError on 500', async () => {
    const f = mockFetch([{ status: 500, ok: false, body: { error: { code: 'INTERNAL', message: 'Server error' } } }]);
    const client = createClient(f);
    await expect(client.status()).rejects.toBeInstanceOf(InternalServerError);
  });

  it('handles non-JSON error responses', async () => {
    const f = vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => { throw new Error('not json'); },
      headers: new Headers(),
    }) as unknown as Response);
    const client = createClient(f);
    await expect(client.status()).rejects.toBeInstanceOf(MemoClawError);
  });
});

describe('retry logic', () => {
  it('retries on 500 and succeeds', async () => {
    const f = mockFetch([
      { status: 500, ok: false, body: { error: { code: 'INTERNAL', message: 'fail' } } },
      { status: 200, body: { wallet: WALLET, free_tier_remaining: 100, free_tier_total: 100, free_tier_used: 0 } },
    ]);
    const client = createClient(f, { maxRetries: 1, retryDelay: 1 });
    const result = await client.status();
    expect(result.free_tier_remaining).toBe(100);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('retries on network error and succeeds', async () => {
    let calls = 0;
    const f = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new TypeError('fetch failed');
      return { ok: true, status: 200, json: async () => ({ wallet: WALLET, free_tier_remaining: 100, free_tier_total: 100, free_tier_used: 0 }), headers: new Headers() } as unknown as Response;
    });
    const client = createClient(f, { maxRetries: 1, retryDelay: 1 });
    const result = await client.status();
    expect(result.free_tier_remaining).toBe(100);
  });

  it('does not retry on 404', async () => {
    const f = mockFetch([{ status: 404, ok: false, body: { error: { code: 'NOT_FOUND', message: 'gone' } } }]);
    const client = createClient(f, { maxRetries: 2 });
    await expect(client.get('nope')).rejects.toBeInstanceOf(NotFoundError);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('exhausts retries and throws last error', async () => {
    const f = mockFetch([
      { status: 500, ok: false, body: { error: { code: 'INTERNAL', message: 'fail' } } },
      { status: 500, ok: false, body: { error: { code: 'INTERNAL', message: 'fail again' } } },
    ]);
    const client = createClient(f, { maxRetries: 1, retryDelay: 1 });
    await expect(client.status()).rejects.toBeInstanceOf(InternalServerError);
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe('iterMemories', () => {
  it('auto-paginates through all memories', async () => {
    const makeMem = (id: string) => ({ id, user_id: 'u1', namespace: 'default', content: 'test', embedding_model: 'e', metadata: {}, importance: 0.5, memory_type: 'general', session_id: null, agent_id: null, created_at: '2025-01-01', updated_at: '2025-01-01', accessed_at: '2025-01-01', access_count: 0, deleted_at: null, expires_at: null, pinned: false, immutable: false });
    const f = mockFetch([
      { status: 200, body: { memories: [makeMem('m1'), makeMem('m2')], total: 3, limit: 2, offset: 0 } },
      { status: 200, body: { memories: [makeMem('m3')], total: 3, limit: 2, offset: 2 } },
    ]);
    const client = createClient(f);
    const memories = [];
    for await (const mem of client.iterMemories({ batchSize: 2 })) {
      memories.push(mem);
    }
    expect(memories).toHaveLength(3);
    expect(memories.map(m => m.id)).toEqual(['m1', 'm2', 'm3']);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('handles empty result', async () => {
    const f = mockFetch([{ status: 200, body: { memories: [], total: 0, limit: 50, offset: 0 } }]);
    const client = createClient(f);
    const memories = [];
    for await (const mem of client.iterMemories()) {
      memories.push(mem);
    }
    expect(memories).toHaveLength(0);
  });
});

describe('wallet signature auth', () => {
  // Well-known test private key (DO NOT use in production)
  const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

  it('derives wallet address from private key', async () => {
    const f = mockFetch([{ status: 200, body: { id: '1', stored: true, deduplicated: false, tokens_used: 10 } }]);
    const client = new MemoClawClient({ privateKey: TEST_PRIVATE_KEY, fetch: f });
    await client.store({ content: 'test' });
    const [, init] = f.mock.calls[0]!;
    const walletHeader = init.headers['X-Wallet'] as string;
    expect(walletHeader).toContain(TEST_ADDRESS);
  });

  it('sends signed auth header in address:timestamp:signature format', async () => {
    const f = mockFetch([{ status: 200, body: { id: '1', stored: true, deduplicated: false, tokens_used: 10 } }]);
    const client = new MemoClawClient({ privateKey: TEST_PRIVATE_KEY, fetch: f });
    await client.store({ content: 'test' });
    const [, init] = f.mock.calls[0]!;
    const walletHeader = init.headers['X-Wallet'] as string;
    const parts = walletHeader.split(':');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe(TEST_ADDRESS);
    expect(Number(parts[1])).toBeGreaterThan(0); // timestamp
    expect(parts[2]).toMatch(/^0x[0-9a-f]+$/i); // hex signature
  });

  it('uses plain wallet when privateKey not provided', async () => {
    const f = mockFetch([{ status: 200, body: { id: '1', stored: true, deduplicated: false, tokens_used: 10 } }]);
    const client = new MemoClawClient({ wallet: WALLET, fetch: f });
    await client.store({ content: 'test' });
    const [, init] = f.mock.calls[0]!;
    expect(init.headers['X-Wallet']).toBe(WALLET);
  });

  it('prefers explicit privateKey over env var', async () => {
    const f = mockFetch([{ status: 200, body: { id: '1', stored: true, deduplicated: false, tokens_used: 10 } }]);
    const client = new MemoClawClient({ privateKey: TEST_PRIVATE_KEY, wallet: '0xIgnored', fetch: f });
    await client.store({ content: 'test' });
    const [, init] = f.mock.calls[0]!;
    const walletHeader = init.headers['X-Wallet'] as string;
    // When privateKey is explicit, it should use signed auth even if wallet is also provided
    expect(walletHeader).toContain(TEST_ADDRESS);
  });
});
