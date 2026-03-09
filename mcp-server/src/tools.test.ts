import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools } from './tools.js';
import type { MemoClawClientInterface } from './types.js';

function createMockClient(): MemoClawClientInterface {
  return {
    store: vi.fn(),
    recall: vi.fn(),
    list: vi.fn(),
    delete: vi.fn(),
    ingest: vi.fn(),
    status: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    assembleContext: vi.fn(),
    textSearch: vi.fn(),
    consolidate: vi.fn(),
    stats: vi.fn(),
    listNamespaces: vi.fn(),
    suggested: vi.fn(),
  };
}

/**
 * Helper to extract registered tools from an McpServer.
 * _registeredTools is an internal plain object keyed by tool name.
 */
function getRegisteredTools(server: McpServer): Record<string, any> {
  return (server as any)._registeredTools;
}

describe('registerTools', () => {
  let server: McpServer;
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    server = new McpServer(
      { name: 'test', version: '0.0.1' },
      { capabilities: { tools: {} } },
    );
    client = createMockClient();
    registerTools(server, client);
  });

  it('registers all 14 tools', () => {
    const tools = getRegisteredTools(server);
    expect(Object.keys(tools).length).toBe(14);
    expect(tools['memoclaw_store']).toBeDefined();
    expect(tools['memoclaw_recall']).toBeDefined();
    expect(tools['memoclaw_list']).toBeDefined();
    expect(tools['memoclaw_delete']).toBeDefined();
    expect(tools['memoclaw_ingest']).toBeDefined();
    expect(tools['memoclaw_status']).toBeDefined();
    expect(tools['memoclaw_get']).toBeDefined();
    expect(tools['memoclaw_update']).toBeDefined();
    expect(tools['memoclaw_context']).toBeDefined();
    expect(tools['memoclaw_search']).toBeDefined();
    expect(tools['memoclaw_consolidate']).toBeDefined();
    expect(tools['memoclaw_stats']).toBeDefined();
    expect(tools['memoclaw_namespaces']).toBeDefined();
    expect(tools['memoclaw_suggested']).toBeDefined();
  });

  describe('memoclaw_store', () => {
    it('calls client.store with correct params', async () => {
      const storeResult = { id: 'mem-1', stored: true, deduplicated: false, tokens_used: 10 };
      (client.store as any).mockResolvedValue(storeResult);

      const tools = getRegisteredTools(server);
      const storeTool = tools['memoclaw_store'];
      const result = await storeTool.handler({ content: 'Hello world', importance: 0.8 }, {} as any);

      expect(client.store).toHaveBeenCalledWith({
        content: 'Hello world',
        importance: 0.8,
      });
      expect(result.content[0].text).toContain('mem-1');
      expect(result.isError).toBeUndefined();
    });

    it('includes tags as metadata', async () => {
      const storeResult = { id: 'mem-2', stored: true, deduplicated: false, tokens_used: 5 };
      (client.store as any).mockResolvedValue(storeResult);

      const tools = getRegisteredTools(server);
      const storeTool = tools['memoclaw_store'];
      await storeTool.handler({ content: 'Tagged', tags: ['test', 'demo'] }, {} as any);

      expect(client.store).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Tagged',
          metadata: { tags: ['test', 'demo'] },
        }),
      );
    });

    it('handles errors gracefully', async () => {
      (client.store as any).mockRejectedValue(new Error('Auth failed'));

      const tools = getRegisteredTools(server);
      const storeTool = tools['memoclaw_store'];
      const result = await storeTool.handler({ content: 'fail' }, {} as any);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Auth failed');
    });
  });

  describe('memoclaw_recall', () => {
    it('calls client.recall with query and filters', async () => {
      const recallResult = {
        memories: [{
          id: 'mem-1',
          content: 'Hello',
          similarity: 0.95,
          importance: 0.8,
          memory_type: 'general',
          namespace: 'default',
          metadata: { tags: ['test'] },
          created_at: '2026-01-01T00:00:00Z',
        }],
        query_tokens: 3,
      };
      (client.recall as any).mockResolvedValue(recallResult);

      const tools = getRegisteredTools(server);
      const recallTool = tools['memoclaw_recall'];
      const result = await recallTool.handler({
        query: 'hello',
        limit: 5,
        tags: ['test'],
      }, {} as any);

      expect(client.recall).toHaveBeenCalledWith({
        query: 'hello',
        limit: 5,
        filters: { tags: ['test'] },
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.memories).toHaveLength(1);
      expect(parsed.memories[0].id).toBe('mem-1');
      expect(parsed.query_tokens).toBe(3);
    });
  });

  describe('memoclaw_list', () => {
    it('calls client.list with pagination params', async () => {
      const listResult = {
        memories: [{
          id: 'mem-1',
          content: 'Test',
          importance: 0.5,
          memory_type: 'general',
          namespace: 'default',
          metadata: {},
          created_at: '2026-01-01T00:00:00Z',
          pinned: false,
        }],
        total: 1,
        limit: 20,
        offset: 0,
      };
      (client.list as any).mockResolvedValue(listResult);

      const tools = getRegisteredTools(server);
      const listTool = tools['memoclaw_list'];
      const result = await listTool.handler({ limit: 20, namespace: 'test-ns' }, {} as any);

      expect(client.list).toHaveBeenCalledWith({ limit: 20, namespace: 'test-ns' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.total).toBe(1);
    });
  });

  describe('memoclaw_delete', () => {
    it('calls client.delete with id', async () => {
      (client.delete as any).mockResolvedValue({ deleted: true, id: 'mem-1' });

      const tools = getRegisteredTools(server);
      const deleteTool = tools['memoclaw_delete'];
      const result = await deleteTool.handler({ id: 'mem-1' }, {} as any);

      expect(client.delete).toHaveBeenCalledWith('mem-1');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.deleted).toBe(true);
    });
  });

  describe('memoclaw_ingest', () => {
    it('calls client.ingest with text', async () => {
      const ingestResult = {
        memory_ids: ['mem-1', 'mem-2'],
        facts_extracted: 3,
        facts_stored: 2,
        facts_deduplicated: 1,
        relations_created: 0,
        tokens_used: 50,
      };
      (client.ingest as any).mockResolvedValue(ingestResult);

      const tools = getRegisteredTools(server);
      const ingestTool = tools['memoclaw_ingest'];
      const result = await ingestTool.handler({
        text: 'User prefers dark mode and uses TypeScript.',
        namespace: 'prefs',
      }, {} as any);

      expect(client.ingest).toHaveBeenCalledWith({
        text: 'User prefers dark mode and uses TypeScript.',
        namespace: 'prefs',
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.facts_extracted).toBe(3);
    });

    it('calls client.ingest with messages', async () => {
      const ingestResult = {
        memory_ids: ['mem-3'],
        facts_extracted: 1,
        facts_stored: 1,
        facts_deduplicated: 0,
        relations_created: 0,
        tokens_used: 20,
      };
      (client.ingest as any).mockResolvedValue(ingestResult);

      const tools = getRegisteredTools(server);
      const ingestTool = tools['memoclaw_ingest'];
      await ingestTool.handler({
        messages: [
          { role: 'user', content: 'I like Python' },
          { role: 'assistant', content: 'Noted!' },
        ],
      }, {} as any);

      expect(client.ingest).toHaveBeenCalledWith({
        messages: [
          { role: 'user', content: 'I like Python' },
          { role: 'assistant', content: 'Noted!' },
        ],
      });
    });
  });

  describe('memoclaw_status', () => {
    it('calls client.status', async () => {
      const statusResult = {
        wallet: '0x1234...5678',
        free_tier_remaining: 85,
        free_tier_total: 100,
        free_tier_used: 15,
      };
      (client.status as any).mockResolvedValue(statusResult);

      const tools = getRegisteredTools(server);
      const statusTool = tools['memoclaw_status'];
      const result = await statusTool.handler({}, {} as any);

      expect(client.status).toHaveBeenCalled();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.free_tier_remaining).toBe(85);
    });
  });

  describe('memoclaw_get', () => {
    it('calls client.get with id', async () => {
      const memory = {
        id: 'mem-1',
        content: 'Test memory',
        importance: 0.8,
        memory_type: 'general',
        namespace: 'default',
        metadata: { tags: ['test'] },
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        accessed_at: '2026-01-02T00:00:00Z',
        access_count: 5,
        pinned: false,
        immutable: false,
        session_id: null,
        agent_id: null,
        expires_at: null,
      };
      (client.get as any).mockResolvedValue(memory);

      const tools = getRegisteredTools(server);
      const result = await tools['memoclaw_get'].handler({ id: 'mem-1' }, {} as any);

      expect(client.get).toHaveBeenCalledWith('mem-1');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.id).toBe('mem-1');
      expect(parsed.content).toBe('Test memory');
    });

    it('handles not found errors', async () => {
      (client.get as any).mockRejectedValue(new Error('Memory not found'));

      const tools = getRegisteredTools(server);
      const result = await tools['memoclaw_get'].handler({ id: 'nonexistent' }, {} as any);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Memory not found');
    });
  });

  describe('memoclaw_update', () => {
    it('calls client.update with id and fields', async () => {
      const updated = {
        id: 'mem-1',
        content: 'Updated content',
        importance: 0.9,
        memory_type: 'preference',
        namespace: 'default',
        metadata: { tags: ['updated'] },
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
        pinned: true,
        immutable: false,
      };
      (client.update as any).mockResolvedValue(updated);

      const tools = getRegisteredTools(server);
      const result = await tools['memoclaw_update'].handler({
        id: 'mem-1',
        content: 'Updated content',
        importance: 0.9,
        pinned: true,
        tags: ['updated'],
      }, {} as any);

      expect(client.update).toHaveBeenCalledWith('mem-1', {
        content: 'Updated content',
        importance: 0.9,
        pinned: true,
        metadata: { tags: ['updated'] },
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.content).toBe('Updated content');
    });
  });

  describe('memoclaw_context', () => {
    it('calls client.assembleContext and returns text format', async () => {
      (client.assembleContext as any).mockResolvedValue({
        context: 'User prefers dark mode.\nUser uses TypeScript.',
        memories_used: 2,
        tokens: 15,
      });

      const tools = getRegisteredTools(server);
      const result = await tools['memoclaw_context'].handler({
        query: 'user preferences',
        max_memories: 5,
      }, {} as any);

      expect(client.assembleContext).toHaveBeenCalledWith({
        query: 'user preferences',
        max_memories: 5,
      });
      expect(result.content[0].text).toContain('User prefers dark mode');
      expect(result.content[0].text).toContain('Memories used: 2');
    });

    it('returns structured format as JSON', async () => {
      const structured = { memories: [{ content: 'test' }] };
      (client.assembleContext as any).mockResolvedValue({
        context: structured,
        memories_used: 1,
        tokens: 5,
      });

      const tools = getRegisteredTools(server);
      const result = await tools['memoclaw_context'].handler({
        query: 'test',
        format: 'structured',
      }, {} as any);

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.context).toEqual(structured);
    });
  });

  describe('memoclaw_search', () => {
    it('calls client.textSearch with params', async () => {
      (client.textSearch as any).mockResolvedValue({
        memories: [{
          id: 'mem-1',
          content: 'Dark mode preference',
          importance: 0.8,
          memory_type: 'preference',
          namespace: 'default',
          metadata: { tags: ['ui'] },
          created_at: '2026-01-01T00:00:00Z',
        }],
        total: 1,
      });

      const tools = getRegisteredTools(server);
      const result = await tools['memoclaw_search'].handler({
        query: 'dark mode',
        limit: 10,
        namespace: 'default',
      }, {} as any);

      expect(client.textSearch).toHaveBeenCalledWith({
        query: 'dark mode',
        limit: 10,
        namespace: 'default',
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.memories).toHaveLength(1);
      expect(parsed.total).toBe(1);
    });
  });

  describe('memoclaw_consolidate', () => {
    it('calls client.consolidate with dry_run', async () => {
      (client.consolidate as any).mockResolvedValue({
        clusters_found: 2,
        memories_merged: 0,
        memories_created: 0,
        clusters: [
          { memory_ids: ['mem-1', 'mem-2'], similarity: 0.95 },
          { memory_ids: ['mem-3', 'mem-4'], similarity: 0.92 },
        ],
      });

      const tools = getRegisteredTools(server);
      const result = await tools['memoclaw_consolidate'].handler({
        dry_run: true,
        min_similarity: 0.9,
      }, {} as any);

      expect(client.consolidate).toHaveBeenCalledWith({
        dry_run: true,
        min_similarity: 0.9,
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.clusters_found).toBe(2);
    });
  });

  describe('memoclaw_stats', () => {
    it('calls client.stats', async () => {
      (client.stats as any).mockResolvedValue({
        total_memories: 150,
        pinned_count: 5,
        never_accessed: 20,
        total_accesses: 500,
        avg_importance: 0.65,
        oldest_memory: '2025-01-01T00:00:00Z',
        newest_memory: '2026-03-09T00:00:00Z',
        by_type: [{ memory_type: 'general', count: 100 }],
        by_namespace: [{ namespace: 'default', count: 150 }],
      });

      const tools = getRegisteredTools(server);
      const result = await tools['memoclaw_stats'].handler({}, {} as any);

      expect(client.stats).toHaveBeenCalled();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.total_memories).toBe(150);
    });
  });

  describe('memoclaw_namespaces', () => {
    it('calls client.listNamespaces', async () => {
      (client.listNamespaces as any).mockResolvedValue({
        namespaces: [
          { name: 'default', count: 100, last_memory_at: '2026-03-09T00:00:00Z' },
          { name: 'prefs', count: 25, last_memory_at: '2026-03-08T00:00:00Z' },
        ],
        total: 2,
      });

      const tools = getRegisteredTools(server);
      const result = await tools['memoclaw_namespaces'].handler({}, {} as any);

      expect(client.listNamespaces).toHaveBeenCalled();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.namespaces).toHaveLength(2);
      expect(parsed.total).toBe(2);
    });
  });

  describe('memoclaw_suggested', () => {
    it('calls client.suggested with filters', async () => {
      (client.suggested as any).mockResolvedValue({
        suggested: [{
          id: 'mem-1',
          content: 'Stale memory',
          importance: 0.3,
          memory_type: 'general',
          namespace: 'default',
          category: 'stale',
          review_score: 0.85,
          created_at: '2025-01-01T00:00:00Z',
          accessed_at: '2025-01-15T00:00:00Z',
          access_count: 1,
        }],
        categories: { stale: 1 },
        total: 1,
      });

      const tools = getRegisteredTools(server);
      const result = await tools['memoclaw_suggested'].handler({
        category: 'stale',
        limit: 10,
      }, {} as any);

      expect(client.suggested).toHaveBeenCalledWith({
        category: 'stale',
        limit: 10,
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.suggested).toHaveLength(1);
      expect(parsed.suggested[0].category).toBe('stale');
    });
  });
});

describe('createServer', () => {
  it('creates a server with tools registered', async () => {
    const { createServer } = await import('./index.js');
    const client = createMockClient();
    const server = createServer(client);

    const tools = getRegisteredTools(server);
    expect(Object.keys(tools).length).toBe(14);
  });
});
