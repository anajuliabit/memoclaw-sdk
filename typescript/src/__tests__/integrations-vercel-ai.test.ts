import { describe, it, expect, vi } from 'vitest';
import { MemoClawClient } from '../index.js';
import { createMemoryContext, createMemoryTools } from '../integrations/vercel-ai.js';

const BASE_URL = 'https://api.memoclaw.com';
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

function mockFetch(responses: Array<{ status: number; body?: unknown }>): typeof globalThis.fetch {
  let callIndex = 0;
  return vi.fn(async () => {
    const resp = responses[callIndex] ?? responses[responses.length - 1]!;
    callIndex++;
    return {
      ok: resp.status >= 200 && resp.status < 300,
      status: resp.status,
      json: async () => resp.body,
      headers: { get: () => null },
    } as unknown as Response;
  });
}

function createClient(fetchFn: typeof globalThis.fetch) {
  return new MemoClawClient({
    privateKey: TEST_PRIVATE_KEY,
    baseUrl: BASE_URL,
    fetch: fetchFn,
    maxRetries: 1,
    retryDelay: 1,
  });
}

describe('createMemoryContext', () => {
  it('getSystemPrompt returns formatted memories', async () => {
    const fetchFn = mockFetch([
      {
        status: 200,
        body: {
          memories: [
            {
              id: '1',
              content: 'User likes dark mode',
              similarity: 0.95,
              importance: 0.8,
              memory_type: 'preference',
              namespace: 'default',
              session_id: null,
              agent_id: null,
              created_at: '2026-01-01T00:00:00Z',
              metadata: {},
              access_count: 1,
            },
            {
              id: '2',
              content: 'User prefers TypeScript',
              similarity: 0.88,
              importance: 0.7,
              memory_type: 'preference',
              namespace: 'default',
              session_id: null,
              agent_id: null,
              created_at: '2026-01-02T00:00:00Z',
              metadata: {},
              access_count: 2,
            },
          ],
          total: 2,
          query_tokens: 5,
        },
      },
    ]);

    const client = createClient(fetchFn);
    const ctx = createMemoryContext(client, { namespace: 'test' });

    const prompt = await ctx.getSystemPrompt('user preferences');
    expect(prompt).toContain('## Relevant Memories');
    expect(prompt).toContain('95% match');
    expect(prompt).toContain('User likes dark mode');
    expect(prompt).toContain('88% match');
    expect(prompt).toContain('User prefers TypeScript');
  });

  it('getSystemPrompt with preamble prepends it', async () => {
    const fetchFn = mockFetch([
      {
        status: 200,
        body: {
          memories: [
            {
              id: '1', content: 'Test memory', similarity: 0.9,
              importance: 0.5, memory_type: 'general', namespace: 'default',
              session_id: null, agent_id: null, created_at: '2026-01-01T00:00:00Z',
              metadata: {}, access_count: 1,
            },
          ],
          total: 1,
          query_tokens: 3,
        },
      },
    ]);

    const client = createClient(fetchFn);
    const ctx = createMemoryContext(client);

    const prompt = await ctx.getSystemPrompt('test', 'You are a helpful assistant.');
    expect(prompt).toMatch(/^You are a helpful assistant\./);
    expect(prompt).toContain('## Relevant Memories');
  });

  it('getSystemPrompt returns empty string when no memories and no preamble', async () => {
    const fetchFn = mockFetch([
      { status: 200, body: { memories: [], total: 0, query_tokens: 3 } },
    ]);

    const client = createClient(fetchFn);
    const ctx = createMemoryContext(client);

    const prompt = await ctx.getSystemPrompt('test');
    expect(prompt).toBe('');
  });

  it('getSystemPrompt returns preamble when no memories found', async () => {
    const fetchFn = mockFetch([
      { status: 200, body: { memories: [], total: 0, query_tokens: 3 } },
    ]);

    const client = createClient(fetchFn);
    const ctx = createMemoryContext(client);

    const prompt = await ctx.getSystemPrompt('test', 'You are a helpful assistant.');
    expect(prompt).toBe('You are a helpful assistant.');
  });

  it('recall returns raw memories', async () => {
    const memories = [
      {
        id: '1', content: 'Test', similarity: 0.9, importance: 0.5,
        memory_type: 'general', namespace: 'default', session_id: null,
        agent_id: null, created_at: '2026-01-01T00:00:00Z', metadata: {},
        access_count: 1,
      },
    ];

    const fetchFn = mockFetch([
      { status: 200, body: { memories, total: 1, query_tokens: 3 } },
    ]);

    const client = createClient(fetchFn);
    const ctx = createMemoryContext(client, { namespace: 'ns', maxMemories: 5 });

    const result = await ctx.recall('test');
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe('Test');
  });

  it('storeMessage stores with correct metadata', async () => {
    const fetchFn = mockFetch([
      { status: 200, body: { id: 'mem-1', stored: true, deduplicated: false, tokens_used: 10 } },
    ]);

    const client = createClient(fetchFn);
    const ctx = createMemoryContext(client, {
      namespace: 'test-ns',
      sessionId: 'sess-1',
      agentId: 'agent-1',
    });

    const id = await ctx.storeMessage('user', 'I like TypeScript', 0.8);
    expect(id).toBe('mem-1');

    const call = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse(call[1].body);
    expect(body.content).toBe('I like TypeScript');
    expect(body.metadata.role).toBe('user');
    expect(body.metadata.tags).toEqual(['conversation']);
    expect(body.namespace).toBe('test-ns');
    expect(body.session_id).toBe('sess-1');
    expect(body.agent_id).toBe('agent-1');
    expect(body.importance).toBe(0.8);
  });

  it('store stores arbitrary memory', async () => {
    const fetchFn = mockFetch([
      { status: 200, body: { id: 'mem-2', stored: true, deduplicated: false, tokens_used: 10 } },
    ]);

    const client = createClient(fetchFn);
    const ctx = createMemoryContext(client, { namespace: 'test-ns' });

    const id = await ctx.store('Important fact', { importance: 1.0, metadata: { tags: ['fact'] } });
    expect(id).toBe('mem-2');
  });
});

describe('createMemoryTools', () => {
  it('returns store_memory and recall_memories tools', () => {
    const fetchFn = mockFetch([]);
    const client = createClient(fetchFn);

    const tools = createMemoryTools(client);
    expect(tools).toHaveProperty('store_memory');
    expect(tools).toHaveProperty('recall_memories');
    expect(tools['store_memory']!.description).toBeTruthy();
    expect(tools['recall_memories']!.description).toBeTruthy();
    expect(tools['store_memory']!.parameters.type).toBe('object');
    expect(tools['recall_memories']!.parameters.type).toBe('object');
  });

  it('store_memory tool stores a memory', async () => {
    const fetchFn = mockFetch([
      { status: 200, body: { id: 'mem-1', stored: true, deduplicated: false, tokens_used: 10 } },
    ]);

    const client = createClient(fetchFn);
    const tools = createMemoryTools(client, { namespace: 'tool-ns' });

    const result = await tools['store_memory']!.execute({
      content: 'User prefers Python',
      importance: 0.9,
      tags: ['preference'],
    });

    expect(result).toEqual({ id: 'mem-1', stored: true });

    const call = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse(call[1].body);
    expect(body.content).toBe('User prefers Python');
    expect(body.importance).toBe(0.9);
    expect(body.namespace).toBe('tool-ns');
    expect(body.metadata.tags).toEqual(['preference']);
  });

  it('recall_memories tool searches memories', async () => {
    const fetchFn = mockFetch([
      {
        status: 200,
        body: {
          memories: [
            {
              id: '1', content: 'User prefers Python', similarity: 0.92,
              importance: 0.9, memory_type: 'preference', namespace: 'default',
              session_id: null, agent_id: null, created_at: '2026-01-01T00:00:00Z',
              metadata: {}, access_count: 1,
            },
          ],
          total: 1,
          query_tokens: 3,
        },
      },
    ]);

    const client = createClient(fetchFn);
    const tools = createMemoryTools(client);

    const result = await tools['recall_memories']!.execute({
      query: 'language preferences',
      limit: 3,
    });

    expect(result).toEqual([
      {
        content: 'User prefers Python',
        similarity: 0.92,
        importance: 0.9,
        created_at: '2026-01-01T00:00:00Z',
      },
    ]);
  });

  it('recall_memories defaults to limit 5', async () => {
    const fetchFn = mockFetch([
      { status: 200, body: { memories: [], total: 0, query_tokens: 3 } },
    ]);

    const client = createClient(fetchFn);
    const tools = createMemoryTools(client);

    await tools['recall_memories']!.execute({ query: 'test' });

    const call = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse(call[1].body);
    expect(body.limit).toBe(5);
  });
});
