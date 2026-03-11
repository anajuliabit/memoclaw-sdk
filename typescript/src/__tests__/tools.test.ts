import { describe, it, expect, vi } from 'vitest';
import {
  getMemoclawTools,
  getMemoclawTool,
  getMemoclawToolNames,
  executeMemoclawTool,
  type ToolDefinition,
  type ToolCall,
} from '../tools.js';
import { MemoClawClient } from '../client.js';

// Well-known Hardhat test private key (DO NOT use in production)
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

function mockFetch(responses: Array<{ status: number; body?: unknown; ok?: boolean }>): typeof globalThis.fetch {
  let callIndex = 0;
  return vi.fn(async () => {
    const resp = responses[callIndex] ?? responses[responses.length - 1]!;
    callIndex++;
    return {
      ok: resp.ok ?? (resp.status >= 200 && resp.status < 300),
      status: resp.status,
      json: async () => resp.body,
      headers: { get: () => null },
    } as unknown as Response;
  });
}

function createClient(fetchFn: typeof globalThis.fetch) {
  return new MemoClawClient({
    privateKey: TEST_PRIVATE_KEY,
    baseUrl: 'https://api.memoclaw.com',
    fetch: fetchFn,
    maxRetries: 0,
    retryDelay: 1,
  });
}

describe('getMemoclawTools', () => {
  it('returns all 5 tools by default', () => {
    const tools = getMemoclawTools();
    expect(tools).toHaveLength(5);
    const names = tools.map((t) => t.function.name);
    expect(names).toContain('store_memory');
    expect(names).toContain('recall_memories');
    expect(names).toContain('list_memories');
    expect(names).toContain('delete_memory');
    expect(names).toContain('get_memory');
  });

  it('all tools have type "function"', () => {
    const tools = getMemoclawTools();
    for (const tool of tools) {
      expect(tool.type).toBe('function');
    }
  });

  it('all tools have valid OpenAI schema structure', () => {
    const tools = getMemoclawTools();
    for (const tool of tools) {
      expect(tool.function.name).toBeTruthy();
      expect(tool.function.description).toBeTruthy();
      expect(tool.function.parameters.type).toBe('object');
      expect(tool.function.parameters.properties).toBeDefined();
    }
  });

  it('filters with include option', () => {
    const tools = getMemoclawTools({ include: ['store_memory', 'recall_memories'] });
    expect(tools).toHaveLength(2);
    const names = tools.map((t) => t.function.name);
    expect(names).toEqual(['store_memory', 'recall_memories']);
  });

  it('filters with exclude option', () => {
    const tools = getMemoclawTools({ exclude: ['delete_memory'] });
    expect(tools).toHaveLength(4);
    const names = tools.map((t) => t.function.name);
    expect(names).not.toContain('delete_memory');
  });

  it('include + exclude combined', () => {
    const tools = getMemoclawTools({
      include: ['store_memory', 'recall_memories', 'delete_memory'],
      exclude: ['delete_memory'],
    });
    expect(tools).toHaveLength(2);
    const names = tools.map((t) => t.function.name);
    expect(names).toEqual(['store_memory', 'recall_memories']);
  });

  it('returns empty array for non-existent include', () => {
    const tools = getMemoclawTools({ include: ['nonexistent_tool'] });
    expect(tools).toHaveLength(0);
  });

  it('returns new array on each call (no mutation)', () => {
    const tools1 = getMemoclawTools();
    const tools2 = getMemoclawTools();
    expect(tools1).not.toBe(tools2);
    expect(tools1).toEqual(tools2);
  });
});

describe('getMemoclawTool', () => {
  it('returns a tool definition by name', () => {
    const tool = getMemoclawTool('store_memory');
    expect(tool).toBeDefined();
    expect(tool!.function.name).toBe('store_memory');
  });

  it('returns undefined for unknown name', () => {
    const tool = getMemoclawTool('nonexistent');
    expect(tool).toBeUndefined();
  });
});

describe('getMemoclawToolNames', () => {
  it('returns all tool names', () => {
    const names = getMemoclawToolNames();
    expect(names).toEqual([
      'store_memory',
      'recall_memories',
      'list_memories',
      'delete_memory',
      'get_memory',
    ]);
  });
});

describe('store_memory tool schema', () => {
  it('requires content', () => {
    const tool = getMemoclawTool('store_memory')!;
    expect(tool.function.parameters.required).toContain('content');
  });

  it('has importance with min/max', () => {
    const tool = getMemoclawTool('store_memory')!;
    const importance = tool.function.parameters.properties['importance']!;
    expect(importance.minimum).toBe(0);
    expect(importance.maximum).toBe(1);
  });

  it('has memory_type enum', () => {
    const tool = getMemoclawTool('store_memory')!;
    const memType = tool.function.parameters.properties['memory_type']!;
    expect(memType.enum).toEqual([
      'correction', 'preference', 'decision', 'project', 'observation', 'general',
    ]);
  });
});

describe('recall_memories tool schema', () => {
  it('requires query', () => {
    const tool = getMemoclawTool('recall_memories')!;
    expect(tool.function.parameters.required).toContain('query');
  });
});

describe('executeMemoclawTool', () => {
  it('executes store_memory', async () => {
    const fetchFn = mockFetch([
      { status: 200, body: { id: 'mem-1', stored: true, deduplicated: false, tokens_used: 10 } },
    ]);
    const client = createClient(fetchFn);

    const result = await executeMemoclawTool(client, {
      id: 'call-1',
      function: {
        name: 'store_memory',
        arguments: JSON.stringify({ content: 'Test memory', importance: 0.8 }),
      },
    });

    expect(result.tool_call_id).toBe('call-1');
    expect(result.name).toBe('store_memory');
    expect(result.is_error).toBeUndefined();
    const parsed = JSON.parse(result.content);
    expect(parsed.id).toBe('mem-1');
    expect(parsed.stored).toBe(true);
  });

  it('executes store_memory with tags', async () => {
    const fetchFn = mockFetch([
      { status: 200, body: { id: 'mem-2', stored: true, deduplicated: false, tokens_used: 10 } },
    ]);
    const client = createClient(fetchFn);

    await executeMemoclawTool(client, {
      id: 'call-2',
      function: {
        name: 'store_memory',
        arguments: JSON.stringify({
          content: 'Tagged memory',
          tags: ['important', 'project-x'],
          namespace: 'test',
        }),
      },
    });

    // Verify the fetch was called with proper body
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const callArgs = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(callArgs[1].body);
    expect(body.content).toBe('Tagged memory');
    expect(body.metadata).toEqual({ tags: ['important', 'project-x'] });
    expect(body.namespace).toBe('test');
  });

  it('executes recall_memories', async () => {
    const fetchFn = mockFetch([
      {
        status: 200,
        body: {
          memories: [{ id: 'mem-1', content: 'Test', similarity: 0.95 }],
          query_tokens: 5,
        },
      },
    ]);
    const client = createClient(fetchFn);

    const result = await executeMemoclawTool(client, {
      id: 'call-3',
      function: {
        name: 'recall_memories',
        arguments: JSON.stringify({ query: 'test', limit: 5 }),
      },
    });

    expect(result.is_error).toBeUndefined();
    const parsed = JSON.parse(result.content);
    expect(parsed.memories).toHaveLength(1);
  });

  it('executes recall_memories with filters', async () => {
    const fetchFn = mockFetch([
      { status: 200, body: { memories: [], query_tokens: 3 } },
    ]);
    const client = createClient(fetchFn);

    await executeMemoclawTool(client, {
      function: {
        name: 'recall_memories',
        arguments: JSON.stringify({
          query: 'test',
          tags: ['bug'],
          memory_type: 'correction',
          namespace: 'prod',
        }),
      },
    });

    const callArgs = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(callArgs[1].body);
    expect(body.filters).toEqual({ tags: ['bug'], memory_type: 'correction' });
    expect(body.namespace).toBe('prod');
  });

  it('executes list_memories', async () => {
    const fetchFn = mockFetch([
      {
        status: 200,
        body: { memories: [], total: 0, limit: 20, offset: 0 },
      },
    ]);
    const client = createClient(fetchFn);

    const result = await executeMemoclawTool(client, {
      id: 'call-4',
      function: {
        name: 'list_memories',
        arguments: JSON.stringify({ limit: 10, namespace: 'test' }),
      },
    });

    expect(result.is_error).toBeUndefined();
    const parsed = JSON.parse(result.content);
    expect(parsed.total).toBe(0);
  });

  it('executes delete_memory', async () => {
    const fetchFn = mockFetch([
      { status: 200, body: { deleted: true, id: 'mem-1' } },
    ]);
    const client = createClient(fetchFn);

    const result = await executeMemoclawTool(client, {
      id: 'call-5',
      function: {
        name: 'delete_memory',
        arguments: JSON.stringify({ id: 'mem-1' }),
      },
    });

    expect(result.is_error).toBeUndefined();
    const parsed = JSON.parse(result.content);
    expect(parsed.deleted).toBe(true);
  });

  it('executes get_memory', async () => {
    const fetchFn = mockFetch([
      {
        status: 200,
        body: { id: 'mem-1', content: 'Hello', importance: 0.5 },
      },
    ]);
    const client = createClient(fetchFn);

    const result = await executeMemoclawTool(client, {
      id: 'call-6',
      function: {
        name: 'get_memory',
        arguments: JSON.stringify({ id: 'mem-1' }),
      },
    });

    expect(result.is_error).toBeUndefined();
    const parsed = JSON.parse(result.content);
    expect(parsed.content).toBe('Hello');
  });

  it('returns error for unknown tool', async () => {
    const fetchFn = mockFetch([]);
    const client = createClient(fetchFn);

    const result = await executeMemoclawTool(client, {
      id: 'call-err',
      function: {
        name: 'unknown_tool',
        arguments: '{}',
      },
    });

    expect(result.is_error).toBe(true);
    const parsed = JSON.parse(result.content);
    expect(parsed.error).toContain('Unknown tool');
  });

  it('returns error for invalid JSON arguments', async () => {
    const fetchFn = mockFetch([]);
    const client = createClient(fetchFn);

    const result = await executeMemoclawTool(client, {
      id: 'call-bad-json',
      function: {
        name: 'store_memory',
        arguments: 'not valid json',
      },
    });

    expect(result.is_error).toBe(true);
    const parsed = JSON.parse(result.content);
    expect(parsed.error).toContain('Invalid JSON');
  });

  it('handles API errors gracefully', async () => {
    const fetchFn = mockFetch([
      {
        status: 401,
        ok: false,
        body: { error: { code: 'UNAUTHORIZED', message: 'Invalid wallet' } },
      },
    ]);
    const client = createClient(fetchFn);

    const result = await executeMemoclawTool(client, {
      id: 'call-api-err',
      function: {
        name: 'get_memory',
        arguments: JSON.stringify({ id: 'mem-1' }),
      },
    });

    expect(result.is_error).toBe(true);
    const parsed = JSON.parse(result.content);
    expect(parsed.error).toBeTruthy();
  });

  it('handles missing tool_call_id', async () => {
    const fetchFn = mockFetch([
      { status: 200, body: { id: 'mem-1', content: 'Hi', importance: 0.5 } },
    ]);
    const client = createClient(fetchFn);

    const result = await executeMemoclawTool(client, {
      function: {
        name: 'get_memory',
        arguments: JSON.stringify({ id: 'mem-1' }),
      },
    });

    expect(result.tool_call_id).toBeUndefined();
    expect(result.name).toBe('get_memory');
    expect(result.is_error).toBeUndefined();
  });
});
