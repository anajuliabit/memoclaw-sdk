/**
 * MCP tool definitions and handlers for MemoClaw.
 *
 * Each tool wraps a MemoClawClient method and exposes it via MCP.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MemoClawClientInterface } from './types.js';
import { z } from 'zod';

const MEMORY_TYPE_ENUM = z.enum([
  'correction', 'preference', 'decision', 'project', 'observation', 'general',
]);

/**
 * Register all MemoClaw tools on the given MCP server.
 */
export function registerTools(server: McpServer, client: MemoClawClientInterface): void {
  // ── memoclaw_store ──────────────────────────────────────────────────
  server.tool(
    'memoclaw_store',
    'Store a memory in MemoClaw. Requires content; optionally set importance (0-1), tags, namespace, memory_type, and more.',
    {
      content: z.string().describe('The memory text to store (max 8192 chars)'),
      importance: z.number().min(0).max(1).optional().describe('Importance score from 0.0 to 1.0'),
      tags: z.array(z.string()).optional().describe('Tags for filtering'),
      namespace: z.string().optional().describe('Namespace to isolate memories'),
      memory_type: MEMORY_TYPE_ENUM.optional().describe('Memory type category'),
      session_id: z.string().optional().describe('Session ID for grouping'),
      agent_id: z.string().optional().describe('Agent ID for multi-agent setups'),
      pinned: z.boolean().optional().describe('Pin memory to prevent decay'),
      immutable: z.boolean().optional().describe('Lock memory from modification'),
    },
    async ({ content, importance, tags, namespace, memory_type, session_id, agent_id, pinned, immutable }) => {
      try {
        const request: Record<string, unknown> = { content };
        if (importance !== undefined) request.importance = importance;
        if (namespace) request.namespace = namespace;
        if (memory_type) request.memory_type = memory_type;
        if (session_id) request.session_id = session_id;
        if (agent_id) request.agent_id = agent_id;
        if (pinned !== undefined) request.pinned = pinned;
        if (immutable !== undefined) request.immutable = immutable;
        if (tags?.length) request.metadata = { tags };

        const result = await client.store(request);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (error: unknown) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(error as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  // ── memoclaw_recall ─────────────────────────────────────────────────
  server.tool(
    'memoclaw_recall',
    'Semantic search across stored memories. Returns the most relevant memories matching the query.',
    {
      query: z.string().describe('Search query for semantic recall'),
      limit: z.number().int().min(1).max(50).optional().describe('Max results to return (default: 10)'),
      namespace: z.string().optional().describe('Filter by namespace'),
      tags: z.array(z.string()).optional().describe('Filter by tags'),
      min_similarity: z.number().min(0).max(1).optional().describe('Minimum similarity threshold'),
      memory_type: MEMORY_TYPE_ENUM.optional().describe('Filter by memory type'),
      include_relations: z.boolean().optional().describe('Include related memories'),
    },
    async ({ query, limit, namespace, tags, min_similarity, memory_type, include_relations }) => {
      try {
        const request: Record<string, unknown> = { query };
        if (limit !== undefined) request.limit = limit;
        if (namespace) request.namespace = namespace;
        if (min_similarity !== undefined) request.min_similarity = min_similarity;
        if (include_relations !== undefined) request.include_relations = include_relations;
        if (tags?.length || memory_type) {
          const filters: Record<string, unknown> = {};
          if (tags?.length) filters.tags = tags;
          if (memory_type) filters.memory_type = memory_type;
          request.filters = filters;
        }

        const result = await client.recall(request);
        const memories = result.memories.map((m) => ({
          id: m.id,
          content: m.content,
          similarity: m.similarity,
          importance: m.importance,
          memory_type: m.memory_type,
          namespace: m.namespace,
          tags: (m.metadata as Record<string, unknown>)?.tags,
          created_at: m.created_at,
        }));

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ memories, query_tokens: result.query_tokens }, null, 2),
          }],
        };
      } catch (error: unknown) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(error as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  // ── memoclaw_list ───────────────────────────────────────────────────
  server.tool(
    'memoclaw_list',
    'List stored memories with optional filters and pagination.',
    {
      limit: z.number().int().min(1).max(100).optional().describe('Max memories to return (default: 20)'),
      offset: z.number().int().min(0).optional().describe('Pagination offset'),
      namespace: z.string().optional().describe('Filter by namespace'),
      tags: z.array(z.string()).optional().describe('Filter by tags'),
      memory_type: MEMORY_TYPE_ENUM.optional().describe('Filter by memory type'),
    },
    async ({ limit, offset, namespace, tags, memory_type }) => {
      try {
        const params: Record<string, unknown> = {};
        if (limit !== undefined) params.limit = limit;
        if (offset !== undefined) params.offset = offset;
        if (namespace) params.namespace = namespace;
        if (tags?.length) params.tags = tags;
        if (memory_type) params.memory_type = memory_type;

        const result = await client.list(params);
        const memories = result.memories.map((m) => ({
          id: m.id,
          content: m.content,
          importance: m.importance,
          memory_type: m.memory_type,
          namespace: m.namespace,
          tags: (m.metadata as Record<string, unknown>)?.tags,
          created_at: m.created_at,
          pinned: m.pinned,
        }));

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ memories, total: result.total, limit: result.limit, offset: result.offset }, null, 2),
          }],
        };
      } catch (error: unknown) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(error as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  // ── memoclaw_delete ─────────────────────────────────────────────────
  server.tool(
    'memoclaw_delete',
    'Delete a memory by its ID (soft delete).',
    {
      id: z.string().describe('Memory ID to delete'),
    },
    async ({ id }) => {
      try {
        const result = await client.delete(id);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (error: unknown) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(error as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  // ── memoclaw_ingest ─────────────────────────────────────────────────
  server.tool(
    'memoclaw_ingest',
    'Ingest a conversation or text and auto-extract memories from it.',
    {
      text: z.string().optional().describe('Raw text to extract memories from'),
      messages: z.array(z.object({
        role: z.string().describe('Message role (user, assistant, system)'),
        content: z.string().describe('Message content'),
      })).optional().describe('Conversation messages to extract memories from'),
      namespace: z.string().optional().describe('Namespace for extracted memories'),
      session_id: z.string().optional().describe('Session ID for grouping'),
      agent_id: z.string().optional().describe('Agent ID'),
      auto_relate: z.boolean().optional().describe('Auto-create relations between extracted memories'),
    },
    async ({ text, messages, namespace, session_id, agent_id, auto_relate }) => {
      try {
        const request: Record<string, unknown> = {};
        if (text) request.text = text;
        if (messages?.length) request.messages = messages;
        if (namespace) request.namespace = namespace;
        if (session_id) request.session_id = session_id;
        if (agent_id) request.agent_id = agent_id;
        if (auto_relate !== undefined) request.auto_relate = auto_relate;

        const result = await client.ingest(request);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (error: unknown) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(error as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  // ── memoclaw_status ─────────────────────────────────────────────────
  server.tool(
    'memoclaw_status',
    'Check free tier usage and remaining API calls.',
    {},
    async () => {
      try {
        const result = await client.status();
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (error: unknown) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(error as Error).message}` }],
          isError: true,
        };
      }
    },
  );
}
