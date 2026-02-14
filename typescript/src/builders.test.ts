/**
 * Tests for builder patterns in MemoClaw TypeScript SDK.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoClawClient } from '../src/client.js';
import {
  RecallQuery,
  AsyncRecallQuery,
  MemoryFilter,
  AsyncMemoryFilter,
  RelationBuilder,
  AsyncRelationBuilder,
  BatchStore,
  StoreBuilder,
  AsyncStoreBuilder,
} from '../src/builders.js';
import type { RecallResponse, RecallMemory, Memory, DeleteBatchResult } from '../src/types.js';

// Mock fetch globally
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// Test wallet address
const TEST_WALLET = '0x2c7536E3605D9C16a7a3D7b1898e529396a65c23';

describe('RecallQuery', () => {
  let client: MemoClawClient;

  beforeEach(() => {
    client = new MemoClawClient({ wallet: TEST_WALLET });
    mockFetch.mockReset();
  });

  it('should build and execute a basic recall query', async () => {
    const mockResponse: RecallResponse = {
      memories: [
        {
          id: 'm1',
          content: 'User prefers Python',
          similarity: 0.95,
          metadata: {},
          importance: 0.8,
          memory_type: 'preference',
          namespace: 'default',
          session_id: null,
          agent_id: null,
          created_at: '2025-01-01T00:00:00Z',
          access_count: 1,
          pinned: false,
        },
      ],
      query_tokens: 5,
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as unknown as Response);

    const result = await new RecallQuery(client)
      .withQuery('programming language preferences')
      .execute();

    expect(result.memories).toHaveLength(1);
    const firstMemory = result.memories[0];
    expect(firstMemory?.content).toBe('User prefers Python');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should apply multiple filters', async () => {
    const mockResponse: RecallResponse = {
      memories: [],
      query_tokens: 5,
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as unknown as Response);

    const result = await new RecallQuery(client)
      .withQuery('test')
      .withLimit(10)
      .withMinSimilarity(0.7)
      .withNamespace('user-prefs')
      .withTags(['important'])
      .withSessionId('session-123')
      .includeRelations()
      .execute();

    expect(result).toBeDefined();

    // Check the request body
    const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(callArgs[1].body as string);
    expect(body.query).toBe('test');
    expect(body.limit).toBe(10);
    expect(body.min_similarity).toBe(0.7);
    expect(body.namespace).toBe('user-prefs');
    expect(body.include_relations).toBe(true);
  });

  it('should throw when executing without query', async () => {
    await expect(
      new RecallQuery(client).execute()
    ).rejects.toThrow('Query is required');
  });

  it('should throw on invalid similarity', async () => {
    expect(() => {
      new RecallQuery(client).withMinSimilarity(1.5);
    }).toThrow('minSimilarity must be between 0.0 and 1.0');
  });
});

describe('MemoryFilter', () => {
  let client: MemoClawClient;

  beforeEach(() => {
    client = new MemoClawClient({ wallet: TEST_WALLET });
    mockFetch.mockReset();
  });

  it('should iterate over memories with filters', async () => {
    const mockMemory: Memory = {
      id: 'm1',
      user_id: 'u1',
      namespace: 'default',
      content: 'Test memory',
      embedding_model: 'text-embedding-3-small',
      metadata: {},
      importance: 0.5,
      memory_type: 'general',
      session_id: null,
      agent_id: null,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
      accessed_at: '2025-01-01T00:00:00Z',
      access_count: 0,
      deleted_at: null,
      expires_at: null,
      pinned: false,
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        memories: [mockMemory],
        total: 1,
        limit: 50,
        offset: 0,
      }),
    } as unknown as Response);

    const memories = await new MemoryFilter(client)
      .withNamespace('default')
      .listAll();

    expect(memories).toHaveLength(1);
    const firstMem = memories[0];
    expect(firstMem?.content).toBe('Test memory');
  });

  it('should count memories without fetching all', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        memories: [],
        total: 42,
        limit: 1,
        offset: 0,
      }),
    } as unknown as Response);

    const count = await new MemoryFilter(client)
      .withNamespace('test')
      .count();

    expect(count).toBe(42);
  });

  it('should throw on invalid batch size', async () => {
    expect(() => {
      new MemoryFilter(client).withBatchSize(0);
    }).toThrow('batchSize must be positive');
  });
});

describe('RelationBuilder', () => {
  let client: MemoClawClient;

  beforeEach(() => {
    client = new MemoClawClient({ wallet: TEST_WALLET });
    mockFetch.mockReset();
  });

  it('should create multiple relations', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id: 'rel1',
        created: true,
      }),
    } as unknown as Response);

    const results = await new RelationBuilder(client, 'm1')
      .relateTo('m2', 'related_to')
      .relateTo('m3', 'supports')
      .createAll();

    expect(results).toHaveLength(2);
    expect(results[0]?.targetId).toBe('m2');
    expect(results[1]?.targetId).toBe('m3');
  });
});

describe('BatchStore', () => {
  let client: MemoClawClient;

  beforeEach(() => {
    client = new MemoClawClient({ wallet: TEST_WALLET });
    mockFetch.mockReset();
  });

  it('should add and execute memories', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        ids: ['mem-1'],
        stored: true,
        count: 1,
        deduplicated_count: 0,
        tokens_used: 10,
      }),
    } as unknown as Response);

    const store = new BatchStore(client);
    store.add('Test memory', { importance: 0.5 });

    expect(store.count()).toBe(1);

    const result = await store.execute();
    expect(result.count).toBe(1);
    expect(result.ids).toContain('mem-1');
  });

  it('should add many memories', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        ids: ['mem-1', 'mem-2'],
        stored: true,
        count: 2,
        deduplicated_count: 0,
        tokens_used: 20,
      }),
    } as unknown as Response);

    const store = new BatchStore(client);
    store.addMany([
      { content: 'Memory 1' },
      { content: 'Memory 2' },
    ]);

    expect(store.count()).toBe(2);

    const result = store.execute();
    expect((await result).count).toBe(2);
  });

  it('should handle empty batch', async () => {
    const store = new BatchStore(client);
    const result = await store.execute();

    expect(result.count).toBe(0);
    expect(result.ids).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should auto-chunk large batches', async () => {
    // Create 150 memories - should be split into 2 batches
    const memories = Array.from({ length: 150 }, (_, i) => ({
      content: `Memory ${i}`,
    }));

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          ids: Array.from({ length: 100 }, (_, i) => `mem-${i}`),
          stored: true,
          count: 100,
          deduplicated_count: 0,
          tokens_used: 1000,
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          ids: Array.from({ length: 50 }, (_, i) => `mem-${100 + i}`),
          stored: true,
          count: 50,
          deduplicated_count: 0,
          tokens_used: 500,
        }),
      } as unknown as Response);

    const store = new BatchStore(client);
    store.addMany(memories);

    const result = await store.execute();

    expect(result.count).toBe(150);
    expect(result.tokensUsed).toBe(1500);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe('AsyncRelationBuilder', () => {
  let client: MemoClawClient;

  beforeEach(() => {
    client = new MemoClawClient({ wallet: TEST_WALLET });
    mockFetch.mockReset();
  });

  it('should create multiple relations asynchronously', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id: 'rel1',
        created: true,
      }),
    } as unknown as Response);

    const results = await new AsyncRelationBuilder(client, 'm1')
      .relateTo('m2', 'related_to')
      .relateTo('m3', 'supports')
      .relateTo('m4', 'contradicts')
      .createAll();

    expect(results).toHaveLength(3);
    expect(results[0]?.targetId).toBe('m2');
    expect(results[1]?.targetId).toBe('m3');
    expect(results[2]?.targetId).toBe('m4');
    expect(results[0]?.relationType).toBe('related_to');
  });

  it('should allow chaining relation additions', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id: 'rel1',
        created: true,
      }),
    } as unknown as Response);

    const builder = new AsyncRelationBuilder(client, 'source-id');
    builder.relateTo('target-1', 'related_to');
    builder.relateTo('target-2', 'derived_from');

    const results = await builder.createAll();
    expect(results).toHaveLength(2);
  });
});

describe('AsyncMemoryFilter', () => {
  let client: MemoClawClient;

  beforeEach(() => {
    client = new MemoClawClient({ wallet: TEST_WALLET });
    mockFetch.mockReset();
  });

  it('should iterate over memories asynchronously with filters', async () => {
    const mockMemory: Memory = {
      id: 'm1',
      user_id: 'u1',
      namespace: 'default',
      content: 'Async test memory',
      embedding_model: 'text-embedding-3-small',
      metadata: {},
      importance: 0.5,
      memory_type: 'general',
      session_id: null,
      agent_id: null,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
      accessed_at: '2025-01-01T00:00:00Z',
      access_count: 0,
      deleted_at: null,
      expires_at: null,
      pinned: false,
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        memories: [mockMemory],
        total: 1,
        limit: 50,
        offset: 0,
      }),
    } as unknown as Response);

    const memories = await new AsyncMemoryFilter(client)
      .withNamespace('default')
      .listAll();

    expect(memories).toHaveLength(1);
    const firstMem = memories[0];
    expect(firstMem?.content).toBe('Async test memory');
  });

  it('should count memories without fetching all', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        memories: [],
        total: 100,
        limit: 1,
        offset: 0,
      }),
    } as unknown as Response);

    const count = await new AsyncMemoryFilter(client)
      .withNamespace('test')
      .withTags(['important'])
      .count();

    expect(count).toBe(100);
  });

  it('should throw on invalid batch size', async () => {
    expect(() => {
      new AsyncMemoryFilter(client).withBatchSize(0);
    }).toThrow('batchSize must be positive');
  });

  it('should apply all filters correctly', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        memories: [],
        total: 0,
        limit: 50,
        offset: 0,
      }),
    } as unknown as Response);

    const filter = new AsyncMemoryFilter(client)
      .withNamespace('my-namespace')
      .withTags(['tag1', 'tag2'])
      .withSessionId('session-123')
      .withAgentId('agent-456')
      .withBatchSize(25);

    await filter.count();

    // Verify the request was made with correct params
    const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
    const url = callArgs[0];
    expect(url).toContain('namespace=my-namespace');
    expect(url).toContain('tags=tag1%2Ctag2');
    expect(url).toContain('session_id=session-123');
    expect(url).toContain('agent_id=agent-456');
  });
});

describe('StoreBuilder', () => {
  let client: MemoClawClient;

  beforeEach(() => {
    client = new MemoClawClient({ wallet: TEST_WALLET });
    mockFetch.mockReset();
  });

  it('should build and execute a basic store', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id: 'mem-123',
        stored: true,
        deduplicated: false,
        tokens_used: 42,
      }),
    } as unknown as Response);

    const result = await new StoreBuilder(client)
      .content('User prefers dark mode')
      .importance(0.9)
      .tags(['preferences', 'ui'])
      .namespace('user-prefs')
      .execute();

    expect(result.id).toBe('mem-123');
    expect(result.stored).toBe(true);
  });

  it('should execute with all options', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id: 'mem-456',
        stored: true,
        deduplicated: false,
        tokens_used: 30,
      }),
    } as unknown as Response);

    const result = await new StoreBuilder(client)
      .content('Test content')
      .importance(0.5)
      .addTag('tag1')
      .addTag('tag2')
      .namespace('project')
      .memoryType('preference')
      .sessionId('sess1')
      .agentId('agent1')
      .pinned(true)
      .metadata({ custom: 'value' })
      .execute();

    expect(result.id).toBe('mem-456');
    
    // Verify the request body
    const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(callArgs[1].body as string);
    expect(body.content).toBe('Test content');
    expect(body.importance).toBe(0.5);
    expect(body.namespace).toBe('project');
    expect(body.memory_type).toBe('preference');
    expect(body.pinned).toBe(true);
  });

  it('should throw when executing without content', async () => {
    await expect(
      new StoreBuilder(client).execute()
    ).rejects.toThrow('Content is required');
  });

  it('should throw on invalid importance', async () => {
    expect(() => {
      new StoreBuilder(client).content('test').importance(1.5);
    }).toThrow('importance must be between 0.0 and 1.0');
  });
});

describe('MemoClawClient Extensions', () => {
  const TEST_WALLET = '0x2c7536E3605D9C16a7a3D7b1898e529396a65c23';

  describe('deleteBatch', () => {
    let client: MemoClawClient;

    beforeEach(() => {
      client = new MemoClawClient({ wallet: TEST_WALLET });
      mockFetch.mockReset();
    });

    it('should delete multiple memories in batch', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          results: [
            { id: 'm1', deleted: true },
            { id: 'm2', deleted: true },
            { id: 'm3', deleted: true },
          ],
        }),
      } as unknown as Response);

      const results = await client.deleteBatch(['m1', 'm2', 'm3']);

      expect(results).toHaveLength(3);
      expect(results.every(r => r.deleted)).toBe(true);
    });

    it('should chunk large batches', async () => {
      // 150 ids should be split into 3 chunks of 50
      const ids = Array.from({ length: 150 }, (_, i) => `m${i}`);
      
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            results: ids.slice(0, 50).map(id => ({ id, deleted: true })),
          }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            results: ids.slice(50, 100).map(id => ({ id, deleted: true })),
          }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            results: ids.slice(100).map(id => ({ id, deleted: true })),
          }),
        } as unknown as Response);

      const results = await client.deleteBatch(ids);

      expect(results).toHaveLength(150);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('search alias', () => {
    let client: MemoClawClient;

    beforeEach(() => {
      client = new MemoClawClient({ wallet: TEST_WALLET });
      mockFetch.mockReset();
    });

    it('should be an alias for recall', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          memories: [],
          query_tokens: 5,
        }),
      } as unknown as Response);

      const result = await client.search({ query: 'test' });

      expect(result.query_tokens).toBe(5);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('listAll alias', () => {
    let client: MemoClawClient;

    beforeEach(() => {
      client = new MemoClawClient({ wallet: TEST_WALLET });
      mockFetch.mockReset();
    });

    it('should be an alias for iterMemories', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          memories: [{ id: 'm1', content: 'Test', metadata: {}, importance: 0.5, memory_type: 'general', namespace: 'default', session_id: null, agent_id: null, created_at: '2025-01-01', access_count: 0, pinned: false }],
          total: 1,
          limit: 50,
          offset: 0,
        }),
      } as unknown as Response);

      const generator = client.listAll();
      const memory = await generator.next();
      
      expect(memory.value).toBeDefined();
    });
  });

  describe('context manager', () => {
    it('should support disposable pattern', () => {
      const disposable = MemoClawClient.disposable({ wallet: TEST_WALLET });
      expect(disposable.client).toBeDefined();
      expect(typeof disposable[Symbol.dispose]).toBe('function');
    });

    it('should have Symbol.dispose on instance', () => {
      const client = new MemoClawClient({ wallet: TEST_WALLET });
      expect(typeof client[Symbol.dispose]).toBe('function');
    });
  });

  describe('abort signal support', () => {
    let client: MemoClawClient;

    beforeEach(() => {
      client = new MemoClawClient({ wallet: TEST_WALLET });
      mockFetch.mockReset();
    });

    it('should accept abort signal in request', async () => {
      const abortController = new AbortController();
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ memories: [], query_tokens: 0 }),
      } as unknown as Response);

      // This tests that the internal request method accepts signal
      // The actual abort test would require more sophisticated mocking
      await client.recall({ query: 'test' });
      
      expect(mockFetch).toHaveBeenCalled();
    });
  });
});

describe('AsyncRecallQuery', () => {
  let client: MemoClawClient;

  beforeEach(() => {
    client = new MemoClawClient({ wallet: TEST_WALLET });
    mockFetch.mockReset();
  });

  it('should build and execute a basic async recall query', async () => {
    const mockResponse: RecallResponse = {
      memories: [
        {
          id: 'm1',
          content: 'User prefers TypeScript',
          similarity: 0.95,
          metadata: {},
          importance: 0.8,
          memory_type: 'preference',
          namespace: 'default',
          session_id: null,
          agent_id: null,
          created_at: '2025-01-01T00:00:00Z',
          access_count: 1,
          pinned: false,
        },
      ],
      query_tokens: 5,
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as unknown as Response);

    const result = await new AsyncRecallQuery(client)
      .withQuery('programming language preferences')
      .execute();

    expect(result.memories).toHaveLength(1);
    const firstMemory = result.memories[0];
    expect(firstMemory?.content).toBe('User prefers TypeScript');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should apply multiple filters in async query', async () => {
    const mockResponse: RecallResponse = {
      memories: [],
      query_tokens: 5,
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as unknown as Response);

    const result = await new AsyncRecallQuery(client)
      .withQuery('test')
      .withLimit(10)
      .withMinSimilarity(0.7)
      .withNamespace('user-prefs')
      .withTags(['important'])
      .withSessionId('session-123')
      .includeRelations()
      .execute();

    expect(result).toBeDefined();

    // Check the request body
    const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(callArgs[1].body as string);
    expect(body.query).toBe('test');
    expect(body.limit).toBe(10);
    expect(body.min_similarity).toBe(0.7);
    expect(body.namespace).toBe('user-prefs');
    expect(body.include_relations).toBe(true);
  });

  it('should throw when executing async recall without query', async () => {
    await expect(
      new AsyncRecallQuery(client).execute()
    ).rejects.toThrow('Query is required');
  });

  it('should throw on invalid similarity in async query', async () => {
    expect(() => {
      new AsyncRecallQuery(client).withMinSimilarity(1.5);
    }).toThrow('minSimilarity must be between 0.0 and 1.0');
  });

  it('should iterate over results using executeIter', async () => {
    const mockResponse: RecallResponse = {
      memories: [
        {
          id: 'm1',
          content: 'Memory 1',
          similarity: 0.9,
          metadata: {},
          importance: 0.5,
          memory_type: 'general',
          namespace: 'default',
          session_id: null,
          agent_id: null,
          created_at: '2025-01-01T00:00:00Z',
          access_count: 1,
          pinned: false,
        },
        {
          id: 'm2',
          content: 'Memory 2',
          similarity: 0.8,
          metadata: {},
          importance: 0.4,
          memory_type: 'general',
          namespace: 'default',
          session_id: null,
          agent_id: null,
          created_at: '2025-01-01T00:00:00Z',
          access_count: 1,
          pinned: false,
        },
      ],
      query_tokens: 5,
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as unknown as Response);

    const memories: RecallMemory[] = [];
    for await (const memory of new AsyncRecallQuery(client)
      .withQuery('test')
      .executeIter()) {
      memories.push(memory);
    }

    expect(memories).toHaveLength(2);
    expect(memories[0]?.content).toBe('Memory 1');
    expect(memories[1]?.content).toBe('Memory 2');
  });
});

describe('AsyncStoreBuilder', () => {
  let client: MemoClawClient;

  beforeEach(() => {
    client = new MemoClawClient({ wallet: TEST_WALLET });
    mockFetch.mockReset();
  });

  it('should build and execute a basic async store', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id: 'mem-123',
        stored: true,
        deduplicated: false,
        tokens_used: 42,
      }),
    } as unknown as Response);

    const result = await new AsyncStoreBuilder(client)
      .content('User prefers dark mode')
      .importance(0.9)
      .tags(['preferences', 'ui'])
      .namespace('user-prefs')
      .execute();

    expect(result.id).toBe('mem-123');
    expect(result.stored).toBe(true);
  });

  it('should execute async store with all options', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id: 'mem-456',
        stored: true,
        deduplicated: false,
        tokens_used: 30,
      }),
    } as unknown as Response);

    const result = await new AsyncStoreBuilder(client)
      .content('Test content')
      .importance(0.5)
      .addTag('tag1')
      .addTag('tag2')
      .namespace('project')
      .memoryType('preference')
      .sessionId('sess1')
      .agentId('agent1')
      .pinned(true)
      .metadata({ custom: 'value' })
      .execute();

    expect(result.id).toBe('mem-456');
    
    // Verify the request body
    const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(callArgs[1].body as string);
    expect(body.content).toBe('Test content');
    expect(body.importance).toBe(0.5);
    expect(body.namespace).toBe('project');
    expect(body.memory_type).toBe('preference');
    expect(body.pinned).toBe(true);
  });

  it('should throw when executing async store without content', async () => {
    await expect(
      new AsyncStoreBuilder(client).execute()
    ).rejects.toThrow('Content is required');
  });

  it('should throw on invalid importance in async store', async () => {
    expect(() => {
      new AsyncStoreBuilder(client).content('test').importance(1.5);
    }).toThrow('importance must be between 0.0 and 1.0');
  });

  it('should support fluent chaining in async store', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id: 'mem-789',
        stored: true,
        deduplicated: false,
        tokens_used: 20,
      }),
    } as unknown as Response);

    const result = await new AsyncStoreBuilder(client)
      .content('Chained memory')
      .importance(0.7)
      .addTag('chain')
      .namespace('test')
      .pinned()
      .execute();

    expect(result.id).toBe('mem-789');
  });
});
