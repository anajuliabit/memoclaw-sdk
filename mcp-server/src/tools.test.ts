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

  it('registers all 6 tools', () => {
    const tools = getRegisteredTools(server);
    expect(Object.keys(tools).length).toBe(6);
    expect(tools['memoclaw_store']).toBeDefined();
    expect(tools['memoclaw_recall']).toBeDefined();
    expect(tools['memoclaw_list']).toBeDefined();
    expect(tools['memoclaw_delete']).toBeDefined();
    expect(tools['memoclaw_ingest']).toBeDefined();
    expect(tools['memoclaw_status']).toBeDefined();
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
});

describe('createServer', () => {
  it('creates a server with tools registered', async () => {
    const { createServer } = await import('./index.js');
    const client = createMockClient();
    const server = createServer(client);

    const tools = getRegisteredTools(server);
    expect(Object.keys(tools).length).toBe(6);
  });
});
