import { describe, it, expect, beforeEach } from 'bun:test';
import { MemoClawClient, MemoClawError } from './client.js';

const BASE_URL = 'https://api.memoclaw.com';
const WALLET = '0x1234567890abcdef1234567890abcdef12345678';

/** Create a mock fetch that returns canned responses. */
function mockFetch(status: number, body: unknown): typeof globalThis.fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

/** Create a mock fetch that captures the request for assertions. */
function captureFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

describe('MemoClawClient', () => {
  let client: MemoClawClient;

  describe('constructor', () => {
    it('should strip trailing slashes from baseUrl', () => {
      const { fetch, calls } = captureFetch(200, { memories: [], total: 0, limit: 20, offset: 0 });
      const c = new MemoClawClient({ wallet: WALLET, baseUrl: 'https://example.com///', fetch });
      c.list();
      // The URL should not have trailing slashes
      expect(calls[0]?.url).toStartWith('https://example.com/v1/');
    });

    it('should use default base URL when not specified', () => {
      const { fetch, calls } = captureFetch(200, { memories: [], total: 0, limit: 20, offset: 0 });
      const c = new MemoClawClient({ wallet: WALLET, fetch });
      c.list();
      expect(calls[0]?.url).toStartWith('https://api.memoclaw.com/v1/');
    });
  });

  describe('request headers', () => {
    it('should send X-Wallet header', async () => {
      const { fetch, calls } = captureFetch(200, { memories: [], total: 0, limit: 20, offset: 0 });
      client = new MemoClawClient({ wallet: WALLET, fetch });
      await client.list();
      const headers = calls[0]?.init?.headers as Record<string, string>;
      expect(headers['X-Wallet']).toBe(WALLET);
    });

    it('should send Content-Type for POST requests', async () => {
      const { fetch, calls } = captureFetch(201, { id: 'mem-1', stored: true, deduplicated: false, tokens_used: 10 });
      client = new MemoClawClient({ wallet: WALLET, fetch });
      await client.store({ content: 'test' });
      const headers = calls[0]?.init?.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('should not send Content-Type for GET requests', async () => {
      const { fetch, calls } = captureFetch(200, { memories: [], total: 0, limit: 20, offset: 0 });
      client = new MemoClawClient({ wallet: WALLET, fetch });
      await client.list();
      const headers = calls[0]?.init?.headers as Record<string, string>;
      expect(headers['Content-Type']).toBeUndefined();
    });
  });

  describe('store', () => {
    it('should POST to /v1/store', async () => {
      const { fetch, calls } = captureFetch(201, { id: 'mem-1', stored: true, deduplicated: false, tokens_used: 42 });
      client = new MemoClawClient({ wallet: WALLET, fetch });
      const result = await client.store({ content: 'Hello world', importance: 0.8 });
      expect(result.id).toBe('mem-1');
      expect(result.stored).toBe(true);
      expect(result.tokens_used).toBe(42);
      expect(calls[0]?.url).toBe(`${BASE_URL}/v1/store`);
      expect(calls[0]?.init?.method).toBe('POST');
      const body = JSON.parse(calls[0]?.init?.body as string);
      expect(body.content).toBe('Hello world');
      expect(body.importance).toBe(0.8);
    });
  });

  describe('storeBatch', () => {
    it('should POST to /v1/store/batch with memories array', async () => {
      const { fetch, calls } = captureFetch(201, { ids: ['m1', 'm2'], stored: true, count: 2, deduplicated_count: 0, tokens_used: 80 });
      client = new MemoClawClient({ wallet: WALLET, fetch });
      const result = await client.storeBatch([{ content: 'a' }, { content: 'b' }]);
      expect(result.ids).toEqual(['m1', 'm2']);
      expect(result.count).toBe(2);
      const body = JSON.parse(calls[0]?.init?.body as string);
      expect(body.memories).toHaveLength(2);
    });
  });

  describe('recall', () => {
    it('should POST to /v1/recall', async () => {
      const { fetch, calls } = captureFetch(200, {
        memories: [{ id: 'm1', content: 'test', similarity: 0.95, metadata: {}, importance: 0.8, memory_type: 'general', namespace: 'default', session_id: null, agent_id: null, created_at: '2025-01-01T00:00:00Z', access_count: 1, pinned: false }],
        query_tokens: 5,
      });
      client = new MemoClawClient({ wallet: WALLET, fetch });
      const result = await client.recall({ query: 'test', limit: 5 });
      expect(result.memories).toHaveLength(1);
      expect(result.memories[0]!.similarity).toBe(0.95);
      expect(result.query_tokens).toBe(5);
      const body = JSON.parse(calls[0]?.init?.body as string);
      expect(body.query).toBe('test');
      expect(body.limit).toBe(5);
    });
  });

  describe('list', () => {
    it('should GET /v1/memories with query params', async () => {
      const { fetch, calls } = captureFetch(200, { memories: [], total: 0, limit: 10, offset: 5 });
      client = new MemoClawClient({ wallet: WALLET, fetch });
      await client.list({ limit: 10, offset: 5, namespace: 'work', tags: ['a', 'b'] });
      const url = calls[0]?.url ?? '';
      expect(url).toContain('limit=10');
      expect(url).toContain('offset=5');
      expect(url).toContain('namespace=work');
      expect(url).toContain('tags=a%2Cb');
      expect(calls[0]?.init?.method).toBe('GET');
    });

    it('should work with no params', async () => {
      const { fetch, calls } = captureFetch(200, { memories: [], total: 0, limit: 20, offset: 0 });
      client = new MemoClawClient({ wallet: WALLET, fetch });
      await client.list();
      expect(calls[0]?.url).toStartWith(`${BASE_URL}/v1/memories`);
    });
  });

  describe('update', () => {
    it('should PATCH /v1/memories/:id', async () => {
      const mem = { id: 'mem-1', user_id: 'u1', namespace: 'default', content: 'updated', embedding_model: 'text-embedding-3-small', metadata: {}, importance: 0.9, memory_type: 'general', session_id: null, agent_id: null, created_at: '2025-01-01', updated_at: '2025-06-01', accessed_at: '2025-01-01', access_count: 1, deleted_at: null, expires_at: null, pinned: false };
      const { fetch, calls } = captureFetch(200, mem);
      client = new MemoClawClient({ wallet: WALLET, fetch });
      const result = await client.update('mem-1', { content: 'updated', importance: 0.9 });
      expect(result.content).toBe('updated');
      expect(calls[0]?.url).toBe(`${BASE_URL}/v1/memories/mem-1`);
      expect(calls[0]?.init?.method).toBe('PATCH');
    });
  });

  describe('delete', () => {
    it('should DELETE /v1/memories/:id', async () => {
      const { fetch, calls } = captureFetch(200, { deleted: true, id: 'mem-1' });
      client = new MemoClawClient({ wallet: WALLET, fetch });
      const result = await client.delete('mem-1');
      expect(result.deleted).toBe(true);
      expect(result.id).toBe('mem-1');
      expect(calls[0]?.init?.method).toBe('DELETE');
    });
  });

  describe('ingest', () => {
    it('should POST to /v1/ingest', async () => {
      const { fetch, calls } = captureFetch(201, { memory_ids: ['a'], facts_extracted: 2, facts_stored: 2, facts_deduplicated: 0, relations_created: 1, tokens_used: 100 });
      client = new MemoClawClient({ wallet: WALLET, fetch });
      const result = await client.ingest({ messages: [{ role: 'user', content: 'I like TypeScript' }] });
      expect(result.facts_extracted).toBe(2);
      expect(result.memory_ids).toEqual(['a']);
    });
  });

  describe('suggested', () => {
    it('should GET /v1/suggested with query params', async () => {
      const { fetch, calls } = captureFetch(200, { suggested: [], categories: {}, total: 0 });
      client = new MemoClawClient({ wallet: WALLET, fetch });
      await client.suggested({ limit: 5, category: 'stale' });
      const url = calls[0]?.url ?? '';
      expect(url).toContain('limit=5');
      expect(url).toContain('category=stale');
    });
  });

  describe('error handling', () => {
    it('should throw MemoClawError on 404', async () => {
      client = new MemoClawClient({
        wallet: WALLET,
        fetch: mockFetch(404, { error: { code: 'NOT_FOUND', message: 'Memory not found' } }),
      });
      try {
        await client.delete('nonexistent');
        expect(true).toBe(false); // should not reach
      } catch (err) {
        expect(err).toBeInstanceOf(MemoClawError);
        const e = err as MemoClawError;
        expect(e.status).toBe(404);
        expect(e.code).toBe('NOT_FOUND');
        expect(e.message).toBe('Memory not found');
      }
    });

    it('should throw MemoClawError on 422', async () => {
      client = new MemoClawClient({
        wallet: WALLET,
        fetch: mockFetch(422, { error: { code: 'VALIDATION_ERROR', message: 'Content too long', details: { max: 8192 } } }),
      });
      try {
        await client.store({ content: 'x'.repeat(10000) });
        expect(true).toBe(false);
      } catch (err) {
        const e = err as MemoClawError;
        expect(e.status).toBe(422);
        expect(e.code).toBe('VALIDATION_ERROR');
        expect(e.details).toEqual({ max: 8192 });
      }
    });

    it('should throw MemoClawError on 429', async () => {
      client = new MemoClawClient({
        wallet: WALLET,
        fetch: mockFetch(429, { error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Rate limit exceeded' } }),
      });
      try {
        await client.store({ content: 'test' });
        expect(true).toBe(false);
      } catch (err) {
        const e = err as MemoClawError;
        expect(e.status).toBe(429);
        expect(e.code).toBe('RATE_LIMIT_EXCEEDED');
      }
    });

    it('should handle non-JSON error responses', async () => {
      const fetch = async () => new Response('Internal Server Error', { status: 500 });
      client = new MemoClawClient({ wallet: WALLET, fetch: fetch as typeof globalThis.fetch });
      try {
        await client.list();
        expect(true).toBe(false);
      } catch (err) {
        const e = err as MemoClawError;
        expect(e.status).toBe(500);
        expect(e.code).toBe('UNKNOWN_ERROR');
      }
    });
  });
});
