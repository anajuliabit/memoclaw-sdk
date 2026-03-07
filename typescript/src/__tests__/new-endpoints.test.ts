import { describe, it, expect, vi } from 'vitest';
import { MemoClawClient } from '../index.js';

const BASE_URL = 'https://api.memoclaw.com';

function mockFetch(responses: Array<{ status: number; body?: unknown; ok?: boolean; headers?: Record<string, string> }>): typeof globalThis.fetch {
  let callIndex = 0;
  return vi.fn(async () => {
    const resp = responses[callIndex] ?? responses[responses.length - 1]!;
    callIndex++;
    const hdrs = new Map(Object.entries(resp.headers ?? {}));
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
  });
}

describe('assembleContext', () => {
  it('should POST /v1/context with query', async () => {
    const fetch = mockFetch([{
      status: 200,
      body: { context: 'User prefers dark mode.', memories_used: 3, tokens: 42 },
    }]);
    const client = createClient(fetch);
    const result = await client.assembleContext({ query: 'user preferences' });
    expect(result.memories_used).toBe(3);
    expect(result.tokens).toBe(42);
    expect(fetch).toHaveBeenCalledWith(
      `${BASE_URL}/v1/context`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('should support all options', async () => {
    const fetch = mockFetch([{
      status: 200,
      body: { context: { memories: [] }, memories_used: 0, tokens: 0 },
    }]);
    const client = createClient(fetch);
    const result = await client.assembleContext({
      query: 'test',
      namespace: 'ns',
      max_memories: 5,
      max_tokens: 2000,
      format: 'structured',
      include_metadata: true,
      summarize: true,
    });
    expect(result.memories_used).toBe(0);
  });

  it('should throw on empty query', async () => {
    const client = createClient(vi.fn());
    await expect(client.assembleContext({ query: '' })).rejects.toThrow('query must be a non-empty string');
  });
});

describe('listNamespaces', () => {
  it('should GET /v1/namespaces', async () => {
    const fetch = mockFetch([{
      status: 200,
      body: {
        namespaces: [
          { name: 'default', count: 42, last_memory_at: '2026-02-13T10:30:00Z' },
          { name: 'project', count: 10, last_memory_at: null },
        ],
        total: 2,
      },
    }]);
    const client = createClient(fetch);
    const result = await client.listNamespaces();
    expect(result.total).toBe(2);
    expect(result.namespaces[0]!.name).toBe('default');
    expect(result.namespaces[0]!.count).toBe(42);
  });
});

describe('stats', () => {
  it('should GET /v1/stats', async () => {
    const fetch = mockFetch([{
      status: 200,
      body: {
        total_memories: 142,
        pinned_count: 8,
        never_accessed: 23,
        total_accesses: 891,
        avg_importance: 0.64,
        oldest_memory: '2025-06-01T08:00:00Z',
        newest_memory: '2026-02-13T10:30:00Z',
        by_type: [{ memory_type: 'preference', count: 45 }],
        by_namespace: [{ namespace: 'default', count: 89 }],
      },
    }]);
    const client = createClient(fetch);
    const result = await client.stats();
    expect(result.total_memories).toBe(142);
    expect(result.by_type[0]!.memory_type).toBe('preference');
  });
});

describe('export', () => {
  it('should GET /v1/export with defaults', async () => {
    const fetch = mockFetch([{
      status: 200,
      body: { format: 'json', memories: [{ id: 'm1' }], count: 1 },
    }]);
    const client = createClient(fetch);
    const result = await client.export();
    expect(result.count).toBe(1);
    expect(result.format).toBe('json');
  });

  it('should pass query params', async () => {
    const fetch = mockFetch([{
      status: 200,
      body: { format: 'csv', memories: [], count: 0 },
    }]);
    const client = createClient(fetch);
    await client.export({ format: 'csv', namespace: 'test', tags: ['a', 'b'], include_deleted: true });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('format=csv'),
      expect.anything(),
    );
  });
});

describe('getHistory', () => {
  it('should GET /v1/memories/:id/history', async () => {
    const fetch = mockFetch([{
      status: 200,
      body: {
        history: [{
          id: 'h1',
          memory_id: 'mem-123',
          changes: { content: 'updated' },
          created_at: '2026-02-13T10:30:00Z',
        }],
      },
    }]);
    const client = createClient(fetch);
    const result = await client.getHistory('mem-123');
    expect(result).toHaveLength(1);
    expect(result[0]!.changes.content).toBe('updated');
  });

  it('should throw on empty id', async () => {
    const client = createClient(vi.fn());
    await expect(client.getHistory('')).rejects.toThrow('memoryId must be a non-empty string');
  });
});

describe('updateBatch', () => {
  it('should POST /v1/memories/batch-update', async () => {
    const fetch = mockFetch([{
      status: 200,
      body: {
        results: [
          { id: 'mem-1', updated: true },
          { id: 'mem-2', updated: true },
        ],
        updated: 2,
        failed: 0,
        tokens_used: 10,
      },
    }]);
    const client = createClient(fetch);
    const result = await client.updateBatch([
      { id: 'mem-1', importance: 0.9 },
      { id: 'mem-2', content: 'Updated', pinned: true },
    ]);
    expect(result.updated).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.results).toHaveLength(2);
    expect(fetch).toHaveBeenCalledWith(
      `${BASE_URL}/v1/memories/batch-update`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('should throw on empty array', async () => {
    const client = createClient(vi.fn());
    await expect(client.updateBatch([])).rejects.toThrow('updates array must not be empty');
  });

  it('should throw when batch exceeds 100', async () => {
    const client = createClient(vi.fn());
    const updates = Array.from({ length: 101 }, (_, i) => ({ id: `mem-${i}`, importance: 0.5 }));
    await expect(client.updateBatch(updates)).rejects.toThrow('exceeds maximum of 100');
  });

  it('should throw on empty id in update', async () => {
    const client = createClient(vi.fn());
    await expect(client.updateBatch([{ id: '', importance: 0.5 }])).rejects.toThrow('non-empty id');
  });
});

describe('coreMemories', () => {
  it('should GET /v1/core-memories', async () => {
    const body = { memories: [{ id: 'mem-1', content: 'core' }], total: 1 };
    const fetchFn = mockFetch([{ status: 200, body }]);
    const client = createClient(fetchFn);
    const result = await client.coreMemories();
    expect(result).toEqual(body);
    expect(fetchFn).toHaveBeenCalledWith(
      `${BASE_URL}/v1/core-memories`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('should pass query params', async () => {
    const body = { memories: [], total: 0 };
    const fetchFn = mockFetch([{ status: 200, body }]);
    const client = createClient(fetchFn);
    await client.coreMemories({ limit: 5, namespace: 'test' });
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining('limit=5'),
      expect.anything(),
    );
  });
});

describe('textSearch', () => {
  it('should GET /v1/memories/search with query', async () => {
    const body = { memories: [{ id: 'mem-1', content: 'hello' }], total: 1 };
    const fetchFn = mockFetch([{ status: 200, body }]);
    const client = createClient(fetchFn);
    const result = await client.textSearch({ query: 'hello' });
    expect(result).toEqual(body);
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining('/v1/memories/search?q=hello'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('should throw on empty query', async () => {
    const client = createClient(vi.fn());
    await expect(client.textSearch({ query: '' })).rejects.toThrow('non-empty string');
  });

  it('should pass all filter params', async () => {
    const body = { memories: [], total: 0 };
    const fetchFn = mockFetch([{ status: 200, body }]);
    const client = createClient(fetchFn);
    await client.textSearch({
      query: 'test',
      limit: 10,
      namespace: 'ns',
      tags: ['a', 'b'],
      memory_type: 'correction',
    });
    const url = (fetchFn as any).mock.calls[0][0] as string;
    expect(url).toContain('q=test');
    expect(url).toContain('limit=10');
    expect(url).toContain('namespace=ns');
    expect(url).toContain('tags=a%2Cb');
    expect(url).toContain('memory_type=correction');
  });
});

describe('deleteBatch', () => {
  it('should POST /v1/memories/batch-delete', async () => {
    const fetch = mockFetch([{
      status: 200,
      body: {
        results: [
          { id: 'mem-1', deleted: true },
          { id: 'mem-2', deleted: true },
        ],
      },
    }]);
    const client = createClient(fetch);
    const results = await client.deleteBatch(['mem-1', 'mem-2']);
    expect(results).toHaveLength(2);
    expect(results[0]!.deleted).toBe(true);
    expect(results[0]!.id).toBe('mem-1');
    expect(fetch).toHaveBeenCalledWith(
      `${BASE_URL}/v1/memories/batch-delete`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('should throw on empty array', async () => {
    const client = createClient(vi.fn());
    await expect(client.deleteBatch([])).rejects.toThrow('ids array must not be empty');
  });

  it('should chunk large batches into groups of 50', async () => {
    const ids = Array.from({ length: 75 }, (_, i) => `mem-${i}`);
    const fetch = mockFetch([
      {
        status: 200,
        body: {
          results: ids.slice(0, 50).map((id) => ({ id, deleted: true })),
        },
      },
      {
        status: 200,
        body: {
          results: ids.slice(50).map((id) => ({ id, deleted: true })),
        },
      },
    ]);
    const client = createClient(fetch);
    const results = await client.deleteBatch(ids);
    expect(results).toHaveLength(75);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('iterExport', () => {
  it('should paginate through memories', async () => {
    const fetch = mockFetch([
      {
        status: 200,
        body: {
          memories: [
            { id: 'mem-1', content: 'first' },
            { id: 'mem-2', content: 'second' },
          ],
          total: 3,
          limit: 2,
          offset: 0,
        },
      },
      {
        status: 200,
        body: {
          memories: [{ id: 'mem-3', content: 'third' }],
          total: 3,
          limit: 2,
          offset: 2,
        },
      },
    ]);
    const client = createClient(fetch);
    const memories: unknown[] = [];
    for await (const mem of client.iterExport({ batchSize: 2 })) {
      memories.push(mem);
    }
    expect(memories).toHaveLength(3);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('should handle empty result', async () => {
    const fetch = mockFetch([{
      status: 200,
      body: { memories: [], total: 0, limit: 50, offset: 0 },
    }]);
    const client = createClient(fetch);
    const memories: unknown[] = [];
    for await (const mem of client.iterExport()) {
      memories.push(mem);
    }
    expect(memories).toEqual([]);
  });

  it('should pass filter params', async () => {
    const fetch = mockFetch([{
      status: 200,
      body: { memories: [], total: 0, limit: 50, offset: 0 },
    }]);
    const client = createClient(fetch);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of client.iterExport({ namespace: 'test', tags: ['a'] })) {
      // consume
    }
    const url = (fetch as any).mock.calls[0][0] as string;
    expect(url).toContain('namespace=test');
    expect(url).toContain('tags=a');
  });
});
