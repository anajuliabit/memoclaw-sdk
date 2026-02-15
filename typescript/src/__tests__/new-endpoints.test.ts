import { describe, it, expect, vi } from 'vitest';
import { MemoClawClient } from '../index.js';

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
    wallet: '0x1234567890abcdef1234567890abcdef12345678',
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
    expect(result.namespaces[0].name).toBe('default');
    expect(result.namespaces[0].count).toBe(42);
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
    expect(result.by_type[0].memory_type).toBe('preference');
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
    expect(result[0].changes.content).toBe('updated');
  });

  it('should throw on empty id', async () => {
    const client = createClient(vi.fn());
    await expect(client.getHistory('')).rejects.toThrow('memoryId must be a non-empty string');
  });
});
