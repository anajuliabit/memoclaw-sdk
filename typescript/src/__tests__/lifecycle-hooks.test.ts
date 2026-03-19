import { describe, it, expect, vi } from 'vitest';
import { MemoClawClient } from '../index.js';

const BASE_URL = 'https://api.memoclaw.com';
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

function mockFetch(responses: Array<{ status: number; body?: unknown; ok?: boolean }>): typeof globalThis.fetch {
  let callIndex = 0;
  return vi.fn(async () => {
    const resp = responses[callIndex] ?? responses[responses.length - 1]!;
    callIndex += 1;
    return {
      ok: resp.ok ?? (resp.status >= 200 && resp.status < 300),
      status: resp.status,
      json: async () => resp.body,
      headers: { get: () => null },
    } as Response;
  });
}

function createClient(fetchImpl: typeof globalThis.fetch): MemoClawClient {
  return new MemoClawClient({
    privateKey: TEST_PRIVATE_KEY,
    baseUrl: BASE_URL,
    fetch: fetchImpl,
  });
}

describe('lifecycle callbacks', () => {
  it('invokes onStore callbacks for store and storeBatch', async () => {
    const fetchImpl = mockFetch([
      { status: 201, body: { id: 'mem-1', stored: true, deduplicated: false, tokens_used: 10 } },
      { status: 201, body: { ids: ['mem-2'], stored: true, count: 1, deduplicated_count: 0, tokens_used: 20 } },
    ]);
    const client = createClient(fetchImpl);
    const handler = vi.fn();
    client.onStore(handler);

    await client.store({ content: 'first' });
    await client.storeBatch([{ content: 'second' }]);

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 'mem-1' }));
    expect(handler).toHaveBeenNthCalledWith(2, expect.objectContaining({ ids: ['mem-2'] }));
  });

  it('invokes onRecall callbacks with query and response payload', async () => {
    const fetchImpl = mockFetch([
      {
        status: 200,
        body: {
          memories: [
            {
              id: 'mem-1',
              content: 'note',
              similarity: 0.9,
              metadata: {},
              importance: 0.5,
              memory_type: 'general',
              namespace: 'default',
              session_id: null,
              agent_id: null,
              created_at: '2025-01-01',
              access_count: 0,
              pinned: false,
              immutable: false,
            },
          ],
          query_tokens: 12,
        },
      },
    ]);
    const client = createClient(fetchImpl);
    const handler = vi.fn();
    client.onRecall(handler);

    await client.recall({ query: 'roadmap' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('roadmap', expect.objectContaining({ memories: expect.any(Array) }));
  });

  it('invokes onDelete callbacks for single and batch deletes', async () => {
    const fetchImpl = mockFetch([
      { status: 200, body: { deleted: true, id: 'mem-1' } },
      {
        status: 200,
        body: {
          results: [
            { id: 'mem-2', deleted: true },
            { id: 'mem-3', deleted: false, error: 'not found' },
          ],
        },
      },
    ]);
    const client = createClient(fetchImpl);
    const handler = vi.fn();
    client.onDelete(handler);

    await client.delete('mem-1');
    await client.deleteBatch(['mem-2', 'mem-3']);

    expect(handler).toHaveBeenCalledTimes(3);
    expect(handler).toHaveBeenNthCalledWith(1, 'mem-1', expect.objectContaining({ deleted: true }));
    expect(handler).toHaveBeenNthCalledWith(2, 'mem-2', expect.objectContaining({ deleted: true }));
    expect(handler).toHaveBeenNthCalledWith(3, 'mem-3', expect.objectContaining({ error: 'not found' }));
  });
});
