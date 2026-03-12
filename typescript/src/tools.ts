/**
 * OpenAI-compatible tool definitions for MemoClaw.
 *
 * Provides pre-built function/tool definitions that work with OpenAI's
 * function calling API, Vercel AI SDK, and any framework that accepts
 * the OpenAI tool format.
 *
 * @example
 * ```ts
 * import { MemoClawClient } from '@memoclaw/sdk';
 * import { getMemoclawTools, executeMemoclawTool } from '@memoclaw/sdk/tools';
 *
 * const client = new MemoClawClient({ privateKey: '0x...' });
 * const tools = getMemoclawTools();
 *
 * // Pass tools to OpenAI
 * const response = await openai.chat.completions.create({
 *   model: 'gpt-4',
 *   messages,
 *   tools,
 * });
 *
 * // Execute the tool call
 * const toolCall = response.choices[0].message.tool_calls[0];
 * const result = await executeMemoclawTool(client, toolCall);
 * ```
 *
 * @module
 */

import type { MemoClawClient } from './client.js';
import type { MemoryType } from './types.js';

// ── OpenAI Tool Types ────────────────────────────────────

/** OpenAI function parameter schema (JSON Schema subset). */
export interface FunctionParameters {
  type: 'object';
  properties: Record<string, {
    type: string;
    description?: string;
    enum?: string[];
    items?: { type: string; enum?: string[] };
    minimum?: number;
    maximum?: number;
    default?: unknown;
  }>;
  required?: string[];
}

/** OpenAI function definition. */
export interface FunctionDefinition {
  name: string;
  description: string;
  parameters: FunctionParameters;
}

/** OpenAI tool definition (function type). */
export interface ToolDefinition {
  type: 'function';
  function: FunctionDefinition;
}

/** Shape of a tool call from OpenAI's API response. */
export interface ToolCall {
  id?: string;
  type?: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/** Result of executing a tool call. */
export interface ToolResult {
  /** The tool call ID (echoed back for OpenAI). */
  tool_call_id?: string;
  /** The tool name that was executed. */
  name: string;
  /** JSON-stringified result of the tool execution. */
  content: string;
  /** Whether the tool execution resulted in an error. */
  is_error?: boolean;
}

// ── Tool Definitions ─────────────────────────────────────

const MEMORY_TYPES: MemoryType[] = [
  'correction', 'preference', 'decision', 'project', 'observation', 'general',
];

const storeMemoryTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'store_memory',
    description:
      'Store a new memory in MemoClaw. Use this to save important information, ' +
      'preferences, corrections, decisions, or observations that should be remembered.',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The memory content to store (max 8192 characters).',
        },
        importance: {
          type: 'number',
          description: 'Importance score from 0.0 (trivial) to 1.0 (critical). Default: 0.5.',
          minimum: 0,
          maximum: 1,
        },
        memory_type: {
          type: 'string',
          description: 'Category of the memory.',
          enum: MEMORY_TYPES,
        },
        namespace: {
          type: 'string',
          description: 'Namespace to isolate this memory (e.g., project name).',
        },
        tags: {
          type: 'array',
          description: 'Tags for filtering and organization.',
          items: { type: 'string' },
        },
      },
      required: ['content'],
    },
  },
};

const recallMemoriesTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'recall_memories',
    description:
      'Search for relevant memories using semantic similarity. ' +
      'Use this to find previously stored information related to a topic or query.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language search query.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of memories to return. Default: 5.',
          minimum: 1,
          maximum: 50,
        },
        min_similarity: {
          type: 'number',
          description: 'Minimum similarity threshold (0.0–1.0). Default: 0.0.',
          minimum: 0,
          maximum: 1,
        },
        namespace: {
          type: 'string',
          description: 'Filter by namespace.',
        },
        tags: {
          type: 'array',
          description: 'Filter by tags.',
          items: { type: 'string' },
        },
        memory_type: {
          type: 'string',
          description: 'Filter by memory type.',
          enum: MEMORY_TYPES,
        },
      },
      required: ['query'],
    },
  },
};

const listMemoriesTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'list_memories',
    description:
      'List stored memories with optional filters. Use this to browse or paginate through memories.',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of memories to return. Default: 20.',
          minimum: 1,
          maximum: 100,
        },
        offset: {
          type: 'number',
          description: 'Pagination offset. Default: 0.',
          minimum: 0,
        },
        namespace: {
          type: 'string',
          description: 'Filter by namespace.',
        },
        tags: {
          type: 'array',
          description: 'Filter by tags.',
          items: { type: 'string' },
        },
        memory_type: {
          type: 'string',
          description: 'Filter by memory type.',
          enum: MEMORY_TYPES,
        },
      },
      required: [],
    },
  },
};

const deleteMemoryTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'delete_memory',
    description:
      'Delete a specific memory by its ID. This is a soft delete — the memory can still be found with include_deleted.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The memory ID to delete.',
        },
      },
      required: ['id'],
    },
  },
};

const getMemoryTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'get_memory',
    description: 'Retrieve a single memory by its ID.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The memory ID to retrieve.',
        },
      },
      required: ['id'],
    },
  },
};

/** All available MemoClaw tool definitions. */
const ALL_TOOLS: ReadonlyArray<ToolDefinition> = [
  storeMemoryTool,
  recallMemoriesTool,
  listMemoriesTool,
  deleteMemoryTool,
  getMemoryTool,
];

/** Map of tool names to their definitions for quick lookup. */
const TOOL_MAP: ReadonlyMap<string, ToolDefinition> = new Map(
  ALL_TOOLS.map((t) => [t.function.name, t]),
);

// ── Public API ───────────────────────────────────────────

/** Options for filtering which tools to return. */
export interface GetToolsOptions {
  /** Only include tools with these names. If omitted, all tools are returned. */
  include?: string[];
  /** Exclude tools with these names. Applied after include. */
  exclude?: string[];
}

/**
 * Get OpenAI-compatible tool definitions for MemoClaw operations.
 *
 * Returns an array of tool definitions that can be passed directly to
 * OpenAI's `tools` parameter, Vercel AI SDK, or any framework that
 * accepts the OpenAI tool format.
 *
 * @example
 * ```ts
 * import { getMemoclawTools } from '@memoclaw/sdk';
 *
 * // All tools
 * const tools = getMemoclawTools();
 *
 * // Only store and recall
 * const tools = getMemoclawTools({ include: ['store_memory', 'recall_memories'] });
 *
 * // All except delete
 * const tools = getMemoclawTools({ exclude: ['delete_memory'] });
 * ```
 */
export function getMemoclawTools(options?: GetToolsOptions): ToolDefinition[] {
  let tools = [...ALL_TOOLS];

  if (options?.include?.length) {
    const includeSet = new Set(options.include);
    tools = tools.filter((t) => includeSet.has(t.function.name));
  }

  if (options?.exclude?.length) {
    const excludeSet = new Set(options.exclude);
    tools = tools.filter((t) => !excludeSet.has(t.function.name));
  }

  return tools;
}

/**
 * Get a single tool definition by name.
 *
 * @returns The tool definition, or undefined if not found.
 */
export function getMemoclawTool(name: string): ToolDefinition | undefined {
  return TOOL_MAP.get(name);
}

/**
 * Get all available MemoClaw tool names.
 */
export function getMemoclawToolNames(): string[] {
  return ALL_TOOLS.map((t) => t.function.name);
}

/**
 * Execute a MemoClaw tool call using the provided client.
 *
 * Parses the tool call arguments, dispatches to the appropriate client
 * method, and returns a formatted result suitable for sending back to
 * the LLM.
 *
 * @example
 * ```ts
 * import { MemoClawClient } from '@memoclaw/sdk';
 * import { executeMemoclawTool } from '@memoclaw/sdk/tools';
 *
 * const client = new MemoClawClient({ privateKey: '0x...' });
 *
 * // From OpenAI response
 * const toolCall = response.choices[0].message.tool_calls[0];
 * const result = await executeMemoclawTool(client, toolCall);
 *
 * // Send result back to OpenAI
 * messages.push({ role: 'tool', ...result });
 * ```
 */
export async function executeMemoclawTool(
  client: MemoClawClient,
  toolCall: ToolCall,
): Promise<ToolResult> {
  const { name, arguments: rawArgs } = toolCall.function;

  let args: Record<string, unknown>;
  try {
    args = JSON.parse(rawArgs);
  } catch {
    return {
      tool_call_id: toolCall.id,
      name,
      content: JSON.stringify({ error: 'Invalid JSON in tool call arguments' }),
      is_error: true,
    };
  }

  try {
    const result = await dispatchTool(client, name, args);
    return {
      tool_call_id: toolCall.id,
      name,
      content: JSON.stringify(result),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      tool_call_id: toolCall.id,
      name,
      content: JSON.stringify({ error: message }),
      is_error: true,
    };
  }
}

/** @internal Dispatch a tool call to the appropriate client method. */
async function dispatchTool(
  client: MemoClawClient,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case 'store_memory': {
      const tags = args.tags as string[] | undefined;
      return client.store({
        content: args.content as string,
        importance: args.importance as number | undefined,
        memory_type: args.memory_type as MemoryType | undefined,
        namespace: args.namespace as string | undefined,
        metadata: tags ? { tags } : undefined,
      });
    }

    case 'recall_memories': {
      const tags = args.tags as string[] | undefined;
      const memoryType = args.memory_type as MemoryType | undefined;
      return client.recall({
        query: args.query as string,
        limit: args.limit as number | undefined,
        min_similarity: args.min_similarity as number | undefined,
        namespace: args.namespace as string | undefined,
        filters: (tags || memoryType)
          ? { tags, memory_type: memoryType }
          : undefined,
      });
    }

    case 'list_memories': {
      return client.list({
        limit: args.limit as number | undefined,
        offset: args.offset as number | undefined,
        namespace: args.namespace as string | undefined,
        tags: args.tags as string[] | undefined,
        memory_type: args.memory_type as MemoryType | undefined,
      });
    }

    case 'delete_memory': {
      return client.delete(args.id as string);
    }

    case 'get_memory': {
      return client.get(args.id as string);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
