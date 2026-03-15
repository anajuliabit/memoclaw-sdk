import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoClawClient } from '../index.js';
import { MemoClawChatMessageHistory, MemoClawRetriever } from '../integrations/langchain.js';
import type { LangChainMessage } from '../integrations/langchain.js';

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

function makeMessage(role: string, content: string): LangChainMessage {
  return {
    content,
    _getType() {
      if (role === 'user') return 'human';
      if (role === 'assistant') return 'ai';
      return role;
    },
  };
}

describe('MemoClawChatMessageHistory', () => {
  it('getMessages returns messages from MemoClaw list', async () => {
    const fetchFn = mockFetch([
      {
        status: 200,
        body: {
          memories: [
            { id: '1', content: 'Hello', metadata: { role: 'user' }, importance: 0.5 },
            { id: '2', content: 'Hi there', metadata: { role: 'assistant' }, importance: 0.5 },
          ],
          total: 2,
        },
      },
    ]);

    const client = createClient(fetchFn);
    const history = new MemoClawChatMessageHistory({
      client,
      sessionId: 'test-session',
    });

    const messages = await history.getMessages();
    expect(messages).toHaveLength(2);
    expect(messages[0]!._getType()).toBe('human');
    expect(messages[0]!.content).toBe('Hello');
    expect(messages[1]!._getType()).toBe('ai');
    expect(messages[1]!.content).toBe('Hi there');
  });

  it('getMessages paginates through all memories', async () => {
    const fetchFn = mockFetch([
      {
        status: 200,
        body: {
          memories: Array.from({ length: 100 }, (_, i) => ({
            id: String(i),
            content: `Message ${i}`,
            metadata: { role: 'user' },
            importance: 0.5,
          })),
          total: 150,
        },
      },
      {
        status: 200,
        body: {
          memories: Array.from({ length: 50 }, (_, i) => ({
            id: String(100 + i),
            content: `Message ${100 + i}`,
            metadata: { role: 'user' },
            importance: 0.5,
          })),
          total: 150,
        },
      },
    ]);

    const client = createClient(fetchFn);
    const history = new MemoClawChatMessageHistory({
      client,
      sessionId: 'test-session',
    });

    const messages = await history.getMessages();
    expect(messages).toHaveLength(150);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('addMessage stores a message with correct role metadata', async () => {
    const fetchFn = mockFetch([
      { status: 200, body: { id: 'mem-1', stored: true, deduplicated: false, tokens_used: 10 } },
    ]);

    const client = createClient(fetchFn);
    const history = new MemoClawChatMessageHistory({
      client,
      sessionId: 'test-session',
      namespace: 'test-ns',
    });

    const msg = makeMessage('user', 'I prefer dark mode');
    await history.addMessage(msg);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const call = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse(call[1].body);
    expect(body.content).toBe('I prefer dark mode');
    expect(body.metadata.role).toBe('user');
    expect(body.metadata.tags).toEqual(['chat_message']);
    expect(body.session_id).toBe('test-session');
    expect(body.namespace).toBe('test-ns');
  });

  it('addMessages batches messages', async () => {
    const fetchFn = mockFetch([
      { status: 200, body: { ids: ['1', '2'], stored: true, count: 2, deduplicated_count: 0, tokens_used: 20 } },
    ]);

    const client = createClient(fetchFn);
    const history = new MemoClawChatMessageHistory({
      client,
      sessionId: 'test-session',
    });

    await history.addMessages([
      makeMessage('user', 'Hello'),
      makeMessage('assistant', 'Hi!'),
    ]);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const call = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse(call[1].body);
    expect(body.memories).toHaveLength(2);
  });

  it('addMessages skips empty array', async () => {
    const fetchFn = mockFetch([]);
    const client = createClient(fetchFn);
    const history = new MemoClawChatMessageHistory({
      client,
      sessionId: 'test-session',
    });

    await history.addMessages([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('clear deletes all session messages', async () => {
    const fetchFn = mockFetch([
      {
        status: 200,
        body: {
          memories: [
            { id: 'mem-1', content: 'Hello', metadata: {}, importance: 0.5 },
            { id: 'mem-2', content: 'World', metadata: {}, importance: 0.5 },
          ],
          total: 2,
        },
      },
      { status: 200, body: { results: [{ id: 'mem-1', deleted: true }, { id: 'mem-2', deleted: true }] } },
    ]);

    const client = createClient(fetchFn);
    const history = new MemoClawChatMessageHistory({
      client,
      sessionId: 'test-session',
    });

    await history.clear();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('clear does nothing when no messages exist', async () => {
    const fetchFn = mockFetch([
      { status: 200, body: { memories: [], total: 0 } },
    ]);

    const client = createClient(fetchFn);
    const history = new MemoClawChatMessageHistory({
      client,
      sessionId: 'test-session',
    });

    await history.clear();
    expect(fetchFn).toHaveBeenCalledTimes(1); // Only the list call
  });

  it('uses custom tag', async () => {
    const fetchFn = mockFetch([
      { status: 200, body: { memories: [], total: 0 } },
    ]);

    const client = createClient(fetchFn);
    const history = new MemoClawChatMessageHistory({
      client,
      sessionId: 'test-session',
      tag: 'custom_tag',
    });

    await history.getMessages();
    const call = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const url = call[0] as string;
    expect(url).toContain('tags=custom_tag');
  });
});

describe('MemoClawRetriever', () => {
  it('invoke returns documents from recall', async () => {
    const fetchFn = mockFetch([
      {
        status: 200,
        body: {
          memories: [
            {
              id: 'mem-1',
              content: 'User prefers dark mode',
              similarity: 0.95,
              importance: 0.8,
              memory_type: 'preference',
              namespace: 'default',
              session_id: null,
              agent_id: null,
              created_at: '2026-01-01T00:00:00Z',
              metadata: { tags: ['ui'] },
              access_count: 3,
            },
          ],
          total: 1,
          query_tokens: 5,
        },
      },
    ]);

    const client = createClient(fetchFn);
    const retriever = new MemoClawRetriever({
      client,
      namespace: 'test-ns',
      topK: 10,
    });

    const docs = await retriever.invoke('user preferences');
    expect(docs).toHaveLength(1);
    expect(docs[0]!.pageContent).toBe('User prefers dark mode');
    expect(docs[0]!.metadata['id']).toBe('mem-1');
    expect(docs[0]!.metadata['similarity']).toBe(0.95);
    expect(docs[0]!.metadata['memory_metadata']).toEqual({ tags: ['ui'] });
  });

  it('getRelevantDocuments is an alias for invoke', async () => {
    const fetchFn = mockFetch([
      { status: 200, body: { memories: [], total: 0, query_tokens: 3 } },
    ]);

    const client = createClient(fetchFn);
    const retriever = new MemoClawRetriever({ client });

    const docs = await retriever.getRelevantDocuments('test');
    expect(docs).toEqual([]);
  });

  it('passes all options to recall request', async () => {
    const fetchFn = mockFetch([
      { status: 200, body: { memories: [], total: 0, query_tokens: 3 } },
    ]);

    const client = createClient(fetchFn);
    const retriever = new MemoClawRetriever({
      client,
      namespace: 'ns',
      tags: ['important'],
      topK: 3,
      minSimilarity: 0.7,
      sessionId: 'sess-1',
      agentId: 'agent-1',
      includeRelations: true,
    });

    await retriever.invoke('test query');

    const call = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse(call[1].body);
    expect(body.query).toBe('test query');
    expect(body.limit).toBe(3);
    expect(body.namespace).toBe('ns');
    expect(body.min_similarity).toBe(0.7);
    expect(body.session_id).toBe('sess-1');
    expect(body.agent_id).toBe('agent-1');
    expect(body.include_relations).toBe(true);
    expect(body.filters).toEqual({ tags: ['important'] });
  });
});
