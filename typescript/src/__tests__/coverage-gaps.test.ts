/**
 * Tests for TypeScript SDK methods that previously had no test coverage.
 * Covers: migrate, migrateDirectory, findRelated, iterMemories, search alias,
 * toString/inspect, per-request timeout/signal, and input validation edge cases.
 *
 * Fixes #115
 */
import { describe, it, expect, vi } from 'vitest';
import { MemoClawClient, MemoClawError } from '../index.js';

const BASE_URL = 'https://api.memoclaw.com';

function mockFetch(
  responses: Array<{ status: number; body?: unknown; ok?: boolean; headers?: Record<string, string> }>,
): typeof globalThis.fetch {
  let callIndex = 0;
  return vi.fn(async () => {
    const resp = responses[callIndex] ?? responses[responses.length - 1]!;
    callIndex++;
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
    maxRetries: 0,
    retryDelay: 1,
  });
}

// ── migrate ─────────────────────────────────────────────────

describe('migrate', () => {
  it('sends POST /v1/migrate with files', async () => {
    const f = mockFetch([{
      status: 201,
      body: {
        memory_ids: ['m1', 'm2'],
        files_processed: 2,
        memories_created: 2,
        memories_deduplicated: 0,
        tokens_used: 120,
      },
    }]);
    const client = createClient(f);
    const result = await client.migrate([
      { filename: 'note1.md', content: '# Note 1\nSome content' },
      { filename: 'note2.md', content: '# Note 2\nMore content' },
    ]);
    expect(result.files_processed).toBe(2);
    expect(result.memories_created).toBe(2);
    expect(result.memory_ids).toEqual(['m1', 'm2']);
    expect(f).toHaveBeenCalledWith(
      `${BASE_URL}/v1/migrate`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('sends optional params (namespace, agent_id, auto_tag)', async () => {
    const f = mockFetch([{
      status: 201,
      body: { memory_ids: ['m1'], files_processed: 1, memories_created: 1, memories_deduplicated: 0, tokens_used: 60 },
    }]);
    const client = createClient(f);
    await client.migrate(
      [{ filename: 'note.md', content: 'content' }],
      { namespace: 'imported', agent_id: 'agent-1', auto_tag: true },
    );
    const sentBody = JSON.parse((f as ReturnType<typeof vi.fn>).mock.calls[0]![1].body);
    expect(sentBody.namespace).toBe('imported');
    expect(sentBody.agent_id).toBe('agent-1');
    expect(sentBody.auto_tag).toBe(true);
  });

  it('throws on empty files array', async () => {
    const client = createClient(vi.fn());
    await expect(client.migrate([])).rejects.toThrow('files array must not be empty');
  });

  it('requires signed auth', async () => {
    const orig = process.env.MEMOCLAW_PRIVATE_KEY;
    delete process.env.MEMOCLAW_PRIVATE_KEY;
    try {
      const client = new MemoClawClient({
        wallet: '0x1234567890abcdef1234567890abcdef12345678',
        baseUrl: BASE_URL,
        fetch: mockFetch([]),
      });
      await expect(
        client.migrate([{ filename: 'x.md', content: 'y' }]),
      ).rejects.toThrow('requires a private key');
    } finally {
      if (orig !== undefined) process.env.MEMOCLAW_PRIVATE_KEY = orig;
    }
  });
});

// ── migrateDirectory ────────────────────────────────────────

describe('migrateDirectory', () => {
  it('reads files from directory and sends them', async () => {
    const f = mockFetch([{
      status: 201,
      body: { memory_ids: ['m1'], files_processed: 1, memories_created: 1, memories_deduplicated: 0, tokens_used: 50 },
    }]);
    const client = createClient(f);

    // Create a temp directory with a test file
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const tmpDir = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'memoclaw-test-'));
    try {
      await writeFile(join(tmpDir, 'test.md'), '# Test\nContent');
      await writeFile(join(tmpDir, 'ignore.txt'), 'not a markdown file');

      const result = await client.migrateDirectory(tmpDir);
      expect(result.files_processed).toBe(1);
      const sentBody = JSON.parse((f as ReturnType<typeof vi.fn>).mock.calls[0]![1].body);
      expect(sentBody.files).toHaveLength(1);
      expect(sentBody.files[0].filename).toBe('test.md');
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it('throws on non-existent directory', async () => {
    const client = createClient(vi.fn());
    await expect(
      client.migrateDirectory('/nonexistent/path/abc123'),
    ).rejects.toThrow('Directory not found');
  });

  it('throws when no files match pattern', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const tmpDir = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'memoclaw-empty-'));
    try {
      const client = createClient(vi.fn());
      await expect(
        client.migrateDirectory(tmpDir),
      ).rejects.toThrow("No files matching '*.md'");
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it('supports custom glob pattern', async () => {
    const f = mockFetch([{
      status: 201,
      body: { memory_ids: ['m1'], files_processed: 1, memories_created: 1, memories_deduplicated: 0, tokens_used: 30 },
    }]);
    const client = createClient(f);

    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const tmpDir = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'memoclaw-glob-'));
    try {
      await writeFile(join(tmpDir, 'note.txt'), 'text content');
      await writeFile(join(tmpDir, 'note.md'), 'markdown content');

      const result = await client.migrateDirectory(tmpDir, { pattern: '*.txt' });
      expect(result.files_processed).toBe(1);
      const sentBody = JSON.parse((f as ReturnType<typeof vi.fn>).mock.calls[0]![1].body);
      expect(sentBody.files[0].filename).toBe('note.txt');
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });
});

// ── findRelated ─────────────────────────────────────────────

describe('findRelated', () => {
  const relationsBody = {
    relations: [
      {
        id: 'r1', relation_type: 'related_to', direction: 'outgoing',
        memory: { id: 'm2', content: 'related', importance: 0.5, memory_type: 'general', namespace: 'default' },
        metadata: {}, created_at: '2025-01-01T00:00:00Z',
      },
      {
        id: 'r2', relation_type: 'contradicts', direction: 'incoming',
        memory: { id: 'm3', content: 'contradicting', importance: 0.7, memory_type: 'correction', namespace: 'default' },
        metadata: {}, created_at: '2025-01-02T00:00:00Z',
      },
      {
        id: 'r3', relation_type: 'supports', direction: 'outgoing',
        memory: { id: 'm4', content: 'supporting', importance: 0.6, memory_type: 'observation', namespace: 'default' },
        metadata: {}, created_at: '2025-01-03T00:00:00Z',
      },
    ],
  };

  it('returns all relations when no filter', async () => {
    const f = mockFetch([{ status: 200, body: relationsBody }]);
    const client = createClient(f);
    const result = await client.findRelated('m1');
    expect(result).toHaveLength(3);
  });

  it('filters by relation type', async () => {
    const f = mockFetch([{ status: 200, body: relationsBody }]);
    const client = createClient(f);
    const result = await client.findRelated('m1', { relationType: 'contradicts' });
    expect(result).toHaveLength(1);
    expect(result[0]!.relation_type).toBe('contradicts');
  });

  it('filters by direction', async () => {
    const f = mockFetch([{ status: 200, body: relationsBody }]);
    const client = createClient(f);
    const result = await client.findRelated('m1', { direction: 'outgoing' });
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.direction === 'outgoing')).toBe(true);
  });

  it('filters by both type and direction', async () => {
    const f = mockFetch([{ status: 200, body: relationsBody }]);
    const client = createClient(f);
    const result = await client.findRelated('m1', { relationType: 'related_to', direction: 'outgoing' });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('r1');
  });

  it('returns empty array when no matches', async () => {
    const f = mockFetch([{ status: 200, body: relationsBody }]);
    const client = createClient(f);
    const result = await client.findRelated('m1', { relationType: 'derived_from' });
    expect(result).toEqual([]);
  });
});

// ── iterMemories ────────────────────────────────────────────

describe('iterMemories', () => {
  it('paginates through all results', async () => {
    const page1 = { memories: [{ id: '1' }, { id: '2' }], total: 3, limit: 2, offset: 0 };
    const page2 = { memories: [{ id: '3' }], total: 3, limit: 2, offset: 2 };
    const f = mockFetch([
      { status: 200, body: page1 },
      { status: 200, body: page2 },
    ]);
    const client = createClient(f);
    const ids: string[] = [];
    for await (const mem of client.iterMemories({ batchSize: 2 })) {
      ids.push(mem.id);
    }
    expect(ids).toEqual(['1', '2', '3']);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('handles empty results', async () => {
    const f = mockFetch([{ status: 200, body: { memories: [], total: 0, limit: 50, offset: 0 } }]);
    const client = createClient(f);
    const ids: string[] = [];
    for await (const mem of client.iterMemories()) {
      ids.push(mem.id);
    }
    expect(ids).toEqual([]);
  });

  it('passes filter params through to list', async () => {
    const f = mockFetch([{ status: 200, body: { memories: [], total: 0, limit: 10, offset: 0 } }]);
    const client = createClient(f);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of client.iterMemories({
      batchSize: 10,
      namespace: 'test-ns',
      tags: ['tag1'],
      memory_type: 'preference',
    })) {
      // consume
    }
    const url = (f as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toContain('namespace=test-ns');
    expect(url).toContain('tags=tag1');
    expect(url).toContain('memory_type=preference');
    expect(url).toContain('limit=10');
  });

  it('stops when offset reaches total', async () => {
    const page1 = { memories: [{ id: '1' }, { id: '2' }], total: 2, limit: 2, offset: 0 };
    const f = mockFetch([{ status: 200, body: page1 }]);
    const client = createClient(f);
    const ids: string[] = [];
    for await (const mem of client.iterMemories({ batchSize: 2 })) {
      ids.push(mem.id);
    }
    expect(ids).toEqual(['1', '2']);
    // Should only call once since offset (2) >= total (2)
    expect(f).toHaveBeenCalledTimes(1);
  });
});

// ── search alias ────────────────────────────────────────────

describe('search (alias for recall)', () => {
  it('delegates to recall and returns same result', async () => {
    const f = mockFetch([{
      status: 200,
      body: {
        memories: [{ id: 'r1', content: 'test', similarity: 0.9 }],
        query_tokens: 3,
      },
    }]);
    const client = createClient(f);
    const result = await client.search({ query: 'test query' });
    expect(result.memories).toHaveLength(1);
    expect(result.query_tokens).toBe(3);
    // Verify it called /v1/recall
    expect(f).toHaveBeenCalledWith(
      `${BASE_URL}/v1/recall`,
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

// ── toString / inspect ──────────────────────────────────────

describe('toString and inspect', () => {
  it('returns human-readable string with truncated wallet (signed mode)', () => {
    const client = createClient(mockFetch([]));
    const str = client.toString();
    expect(str).toContain('MemoClawClient');
    expect(str).toContain(BASE_URL);
    expect(str).toContain('signed');
    // Wallet should be truncated
    expect(str).toMatch(/0x[a-fA-F0-9]{4}\.\.\.[a-fA-F0-9]{4}/);
  });

  it('shows wallet-only mode', () => {
    const orig = process.env.MEMOCLAW_PRIVATE_KEY;
    delete process.env.MEMOCLAW_PRIVATE_KEY;
    try {
      const client = new MemoClawClient({
        wallet: '0x1234567890abcdef1234567890abcdef12345678',
        baseUrl: BASE_URL,
        fetch: mockFetch([]),
      });
      const str = client.toString();
      expect(str).toContain('wallet-only');
    } finally {
      if (orig !== undefined) process.env.MEMOCLAW_PRIVATE_KEY = orig;
    }
  });

  it('exposes custom inspect symbol', () => {
    const client = createClient(mockFetch([]));
    const inspectSymbol = Symbol.for('nodejs.util.inspect.custom');
    const inspectResult = (client as any)[inspectSymbol]();
    expect(inspectResult).toBe(client.toString());
  });
});

// ── Per-request timeout and signal ──────────────────────────

describe('per-request timeout and signal', () => {
  it('aborts request when signal is triggered', async () => {
    const controller = new AbortController();
    // Create a fetch that delays, giving time to abort
    const f: typeof globalThis.fetch = vi.fn(async (_url, init?) => {
      // Check if already aborted
      if (init?.signal?.aborted) {
        throw new DOMException('The operation was aborted', 'AbortError');
      }
      // Simulate slow response
      return new Promise<Response>((_resolve, reject) => {
        const onAbort = () => reject(new DOMException('The operation was aborted', 'AbortError'));
        init?.signal?.addEventListener('abort', onAbort);
      });
    });
    const client = createClient(f);

    // Abort immediately
    controller.abort();
    await expect(
      client.status({ signal: controller.signal }),
    ).rejects.toThrow();
  });

  it('passes per-request timeout', async () => {
    // With a very short timeout, the request should eventually abort
    // We test that the option is accepted without errors when the request succeeds quickly
    const f = mockFetch([{
      status: 200,
      body: { wallet: '0x', free_tier_remaining: 10, free_tier_total: 100, free_tier_used: 90 },
    }]);
    const client = createClient(f);
    const result = await client.status({ timeout: 5000 });
    expect(result.free_tier_remaining).toBe(10);
  });
});

// ── Input validation edge cases ─────────────────────────────

describe('input validation edge cases', () => {
  it('store rejects whitespace-only content', async () => {
    const client = createClient(vi.fn());
    await expect(client.store({ content: '   ' })).rejects.toThrow('content must be a non-empty string');
    await expect(client.store({ content: '\t\n' })).rejects.toThrow('content must be a non-empty string');
  });

  it('storeBatch rejects items with empty content', async () => {
    const client = createClient(vi.fn());
    await expect(
      client.storeBatch([{ content: 'valid' }, { content: '' }]),
    ).rejects.toThrow('non-empty content');
  });

  it('storeBatch rejects empty array', async () => {
    const client = createClient(vi.fn());
    await expect(client.storeBatch([])).rejects.toThrow('memories array must not be empty');
  });

  it('storeBatch rejects > 100 items', async () => {
    const client = createClient(vi.fn());
    const items = Array.from({ length: 101 }, (_, i) => ({ content: `item ${i}` }));
    await expect(client.storeBatch(items)).rejects.toThrow('exceeds maximum of 100');
  });

  it('recall rejects empty query', async () => {
    const client = createClient(vi.fn());
    await expect(client.recall({ query: '' })).rejects.toThrow('query must be a non-empty string');
    await expect(client.recall({ query: '  ' })).rejects.toThrow('query must be a non-empty string');
  });

  it('get rejects empty id', async () => {
    const client = createClient(vi.fn());
    await expect(client.get('')).rejects.toThrow('id must be a non-empty string');
    await expect(client.get('   ')).rejects.toThrow('id must be a non-empty string');
  });

  it('update rejects empty id', async () => {
    const client = createClient(vi.fn());
    await expect(client.update('', { content: 'x' })).rejects.toThrow('id must be a non-empty string');
  });

  it('delete rejects empty id', async () => {
    const client = createClient(vi.fn());
    await expect(client.delete('')).rejects.toThrow('id must be a non-empty string');
  });

  it('createRelation rejects empty memoryId', async () => {
    const client = createClient(vi.fn());
    await expect(
      client.createRelation('', { target_id: 'x', relation_type: 'related_to' }),
    ).rejects.toThrow('memoryId must be a non-empty string');
  });

  it('createRelation rejects empty target_id', async () => {
    const client = createClient(vi.fn());
    await expect(
      client.createRelation('m1', { target_id: '', relation_type: 'related_to' }),
    ).rejects.toThrow('target_id must be a non-empty string');
  });

  it('listRelations rejects empty memoryId', async () => {
    const client = createClient(vi.fn());
    await expect(client.listRelations('')).rejects.toThrow('memoryId must be a non-empty string');
  });

  it('deleteRelation rejects empty ids', async () => {
    const client = createClient(vi.fn());
    await expect(client.deleteRelation('', 'r1')).rejects.toThrow('memoryId must be a non-empty string');
    await expect(client.deleteRelation('m1', '')).rejects.toThrow('relationId must be a non-empty string');
  });

  it('ingest rejects when neither messages nor text provided', async () => {
    const client = createClient(vi.fn());
    await expect(client.ingest({})).rejects.toThrow('Either messages or text must be provided');
  });

  it('extract rejects empty messages', async () => {
    const client = createClient(vi.fn());
    await expect(client.extract({ messages: [] })).rejects.toThrow('messages must be a non-empty array');
  });

  it('assembleContext rejects empty query', async () => {
    const client = createClient(vi.fn());
    await expect(client.assembleContext({ query: '' })).rejects.toThrow('query must be a non-empty string');
  });

  it('textSearch rejects empty query', async () => {
    const client = createClient(vi.fn());
    await expect(client.textSearch({ query: '' })).rejects.toThrow('query must be a non-empty string');
  });
});

// ── dispose / Symbol.dispose ────────────────────────────────

describe('dispose', () => {
  it('Symbol.dispose is callable', () => {
    const client = createClient(mockFetch([]));
    expect(() => client[Symbol.dispose]()).not.toThrow();
  });

  it('dispose() method is callable', () => {
    const client = createClient(mockFetch([]));
    expect(() => client.dispose()).not.toThrow();
  });

  it('static disposable() returns client with Symbol.dispose', () => {
    const disposable = MemoClawClient.disposable({
      privateKey: TEST_PRIVATE_KEY,
      baseUrl: BASE_URL,
      fetch: mockFetch([]),
    });
    expect(disposable.client).toBeInstanceOf(MemoClawClient);
    expect(() => disposable[Symbol.dispose]()).not.toThrow();
  });
});

// ── client-level timeout ────────────────────────────────────

describe('client-level timeout option', () => {
  it('accepts timeout in constructor without error', async () => {
    const f = mockFetch([{
      status: 200,
      body: { wallet: '0x', free_tier_remaining: 10, free_tier_total: 100, free_tier_used: 90 },
    }]);
    const client = new MemoClawClient({
      privateKey: TEST_PRIVATE_KEY,
      baseUrl: BASE_URL,
      fetch: f,
      timeout: 10000,
    });
    const result = await client.status();
    expect(result.free_tier_remaining).toBe(10);
  });
});

// ── Parameter validation tests ──────────────────────────────────────────────

describe('parameter validation', () => {
  const client = new MemoClawClient({
    privateKey: TEST_PRIVATE_KEY,
    baseUrl: BASE_URL,
    fetch: mockFetch([]),
  });

  it('recall rejects negative limit', async () => {
    await expect(client.recall({ query: 'test', limit: -1 })).rejects.toThrow('limit must be a positive integer');
  });

  it('recall rejects zero limit', async () => {
    await expect(client.recall({ query: 'test', limit: 0 })).rejects.toThrow('limit must be a positive integer');
  });

  it('recall rejects min_similarity > 1', async () => {
    await expect(client.recall({ query: 'test', min_similarity: 1.5 })).rejects.toThrow('min_similarity must be between');
  });

  it('recall rejects negative min_similarity', async () => {
    await expect(client.recall({ query: 'test', min_similarity: -0.1 })).rejects.toThrow('min_similarity must be between');
  });

  it('list rejects negative limit', async () => {
    await expect(client.list({ limit: -1 })).rejects.toThrow('limit must be a positive integer');
  });

  it('list rejects negative offset', async () => {
    await expect(client.list({ offset: -5 })).rejects.toThrow('offset must be a non-negative integer');
  });

  it('iterMemories rejects zero batchSize', async () => {
    const gen = client.iterMemories({ batchSize: 0 });
    await expect(gen.next()).rejects.toThrow('batchSize must be a positive integer');
  });

  it('suggested rejects negative limit', async () => {
    await expect(client.suggested({ limit: -1 })).rejects.toThrow('limit must be a positive integer');
  });

  it('textSearch rejects negative limit', async () => {
    await expect(client.textSearch({ query: 'test', limit: -1 })).rejects.toThrow('limit must be a positive integer');
  });

  it('coreMemories rejects negative limit', async () => {
    await expect(client.coreMemories({ limit: -1 })).rejects.toThrow('limit must be a positive integer');
  });

  it('iterExport rejects zero batchSize', async () => {
    const gen = client.iterExport({ batchSize: 0 });
    await expect(gen.next()).rejects.toThrow('batchSize must be a positive integer');
  });
});
