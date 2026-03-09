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

  // ── memoclaw_get ────────────────────────────────────────────────────
  server.tool(
    'memoclaw_get',
    'Get a single memory by its ID. Returns full memory details including metadata, access count, and timestamps.',
    {
      id: z.string().describe('Memory ID to retrieve'),
    },
    async ({ id }) => {
      try {
        const result = await client.get(id);
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

  // ── memoclaw_update ─────────────────────────────────────────────────
  server.tool(
    'memoclaw_update',
    'Update an existing memory. Can modify content, importance, tags, namespace, memory type, pinned/immutable status, and expiration.',
    {
      id: z.string().describe('Memory ID to update'),
      content: z.string().optional().describe('New content for the memory'),
      importance: z.number().min(0).max(1).optional().describe('New importance score'),
      tags: z.array(z.string()).optional().describe('New tags (replaces existing)'),
      namespace: z.string().optional().describe('New namespace'),
      memory_type: MEMORY_TYPE_ENUM.optional().describe('New memory type'),
      pinned: z.boolean().optional().describe('Pin or unpin the memory'),
      immutable: z.boolean().optional().describe('Lock or unlock the memory'),
      expires_at: z.string().optional().describe('New expiration timestamp (ISO 8601), or null to remove'),
    },
    async ({ id, content, importance, tags, namespace, memory_type, pinned, immutable, expires_at }) => {
      try {
        const request: Record<string, unknown> = {};
        if (content !== undefined) request.content = content;
        if (importance !== undefined) request.importance = importance;
        if (namespace) request.namespace = namespace;
        if (memory_type) request.memory_type = memory_type;
        if (pinned !== undefined) request.pinned = pinned;
        if (immutable !== undefined) request.immutable = immutable;
        if (expires_at !== undefined) request.expires_at = expires_at;
        if (tags !== undefined) request.metadata = { tags };

        const result = await client.update(id, request);
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

  // ── memoclaw_context ────────────────────────────────────────────────
  server.tool(
    'memoclaw_context',
    'Assemble a context block from relevant memories for use in prompts. Returns formatted text or structured data with the most relevant memories for a given query.',
    {
      query: z.string().describe('Query to find relevant memories for context'),
      namespace: z.string().optional().describe('Filter by namespace'),
      session_id: z.string().optional().describe('Filter by session'),
      agent_id: z.string().optional().describe('Filter by agent'),
      max_memories: z.number().int().min(1).max(50).optional().describe('Maximum memories to include (default: 10)'),
      max_tokens: z.number().int().min(100).optional().describe('Maximum tokens in context block'),
      format: z.enum(['text', 'structured']).optional().describe('Output format (default: text)'),
      include_metadata: z.boolean().optional().describe('Include metadata in output'),
      summarize: z.boolean().optional().describe('Summarize memories for more compact context'),
    },
    async ({ query, namespace, session_id, agent_id, max_memories, max_tokens, format, include_metadata, summarize }) => {
      try {
        const request: Record<string, unknown> = { query };
        if (namespace) request.namespace = namespace;
        if (session_id) request.session_id = session_id;
        if (agent_id) request.agent_id = agent_id;
        if (max_memories !== undefined) request.max_memories = max_memories;
        if (max_tokens !== undefined) request.max_tokens = max_tokens;
        if (format) request.format = format;
        if (include_metadata !== undefined) request.include_metadata = include_metadata;
        if (summarize !== undefined) request.summarize = summarize;

        const result = await client.assembleContext(request);
        return {
          content: [{
            type: 'text' as const,
            text: typeof result.context === 'string'
              ? `${result.context}\n\n---\nMemories used: ${result.memories_used} | Tokens: ${result.tokens}`
              : JSON.stringify(result, null, 2),
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

  // ── memoclaw_search ─────────────────────────────────────────────────
  server.tool(
    'memoclaw_search',
    'Full-text keyword search across memories. Complementary to semantic recall — use for exact matches, specific terms, or when you know the exact phrasing.',
    {
      query: z.string().describe('Search query (keyword-based)'),
      limit: z.number().int().min(1).max(50).optional().describe('Max results (default: 10)'),
      namespace: z.string().optional().describe('Filter by namespace'),
      tags: z.array(z.string()).optional().describe('Filter by tags'),
      memory_type: MEMORY_TYPE_ENUM.optional().describe('Filter by memory type'),
      session_id: z.string().optional().describe('Filter by session'),
      agent_id: z.string().optional().describe('Filter by agent'),
      after: z.string().optional().describe('Only memories created after this ISO timestamp'),
    },
    async ({ query, limit, namespace, tags, memory_type, session_id, agent_id, after }) => {
      try {
        const params: Record<string, unknown> = { query };
        if (limit !== undefined) params.limit = limit;
        if (namespace) params.namespace = namespace;
        if (tags?.length) params.tags = tags;
        if (memory_type) params.memory_type = memory_type;
        if (session_id) params.session_id = session_id;
        if (agent_id) params.agent_id = agent_id;
        if (after) params.after = after;

        const result = await client.textSearch(params);
        const memories = result.memories.map((m) => ({
          id: m.id,
          content: m.content,
          importance: m.importance,
          memory_type: m.memory_type,
          namespace: m.namespace,
          tags: (m.metadata as Record<string, unknown>)?.tags,
          created_at: m.created_at,
        }));

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ memories, total: result.total }, null, 2),
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

  // ── memoclaw_consolidate ────────────────────────────────────────────
  server.tool(
    'memoclaw_consolidate',
    'Find and merge duplicate or very similar memories. Use dry_run=true to preview what would be merged without making changes.',
    {
      namespace: z.string().optional().describe('Limit consolidation to a namespace'),
      min_similarity: z.number().min(0).max(1).optional().describe('Minimum similarity to consider as duplicate (default: 0.9)'),
      mode: z.string().optional().describe('Consolidation mode'),
      dry_run: z.boolean().optional().describe('Preview only — do not actually merge (default: false)'),
    },
    async ({ namespace, min_similarity, mode, dry_run }) => {
      try {
        const request: Record<string, unknown> = {};
        if (namespace) request.namespace = namespace;
        if (min_similarity !== undefined) request.min_similarity = min_similarity;
        if (mode) request.mode = mode;
        if (dry_run !== undefined) request.dry_run = dry_run;

        const result = await client.consolidate(request);
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

  // ── memoclaw_stats ──────────────────────────────────────────────────
  server.tool(
    'memoclaw_stats',
    'Get memory statistics: total count, breakdown by type and namespace, importance averages, access patterns.',
    {},
    async () => {
      try {
        const result = await client.stats();
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

  // ── memoclaw_namespaces ─────────────────────────────────────────────
  server.tool(
    'memoclaw_namespaces',
    'List all namespaces with memory counts. Useful for understanding how memories are organized.',
    {},
    async () => {
      try {
        const result = await client.listNamespaces();
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

  // ── memoclaw_suggested ──────────────────────────────────────────────
  server.tool(
    'memoclaw_suggested',
    'Get memories that may need review: stale memories, decaying importance, or frequently accessed hot memories.',
    {
      limit: z.number().int().min(1).max(50).optional().describe('Max results (default: 20)'),
      namespace: z.string().optional().describe('Filter by namespace'),
      session_id: z.string().optional().describe('Filter by session'),
      agent_id: z.string().optional().describe('Filter by agent'),
      category: z.enum(['stale', 'fresh', 'hot', 'decaying']).optional().describe('Filter by category'),
    },
    async ({ limit, namespace, session_id, agent_id, category }) => {
      try {
        const params: Record<string, unknown> = {};
        if (limit !== undefined) params.limit = limit;
        if (namespace) params.namespace = namespace;
        if (session_id) params.session_id = session_id;
        if (agent_id) params.agent_id = agent_id;
        if (category) params.category = category;

        const result = await client.suggested(params);
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
