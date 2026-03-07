#!/usr/bin/env node
/**
 * MemoClaw MCP Server
 *
 * Exposes MemoClaw memory operations as MCP tools for use with
 * Claude Desktop, Cursor, Windsurf, and any MCP-compatible client.
 *
 * Authentication:
 *   - Set MEMOCLAW_PRIVATE_KEY env var (full access, signed requests)
 *   - Or set MEMOCLAW_WALLET env var (free endpoints only)
 *   - Or create ~/.memoclaw/config.json via `memoclaw init`
 *
 * Usage:
 *   npx @memoclaw/mcp-server
 *
 * Claude Desktop config (~/.claude/claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "memoclaw": {
 *         "command": "npx",
 *         "args": ["@memoclaw/mcp-server"],
 *         "env": {
 *           "MEMOCLAW_PRIVATE_KEY": "your-private-key"
 *         }
 *       }
 *     }
 *   }
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools.js';
import { createClient } from './client.js';
import type { MemoClawClientInterface } from './types.js';

export { registerTools } from './tools.js';
export { createClient } from './client.js';
export type { MemoClawClientInterface } from './types.js';

/**
 * Create and configure the MCP server with all MemoClaw tools.
 */
export function createServer(client: MemoClawClientInterface): McpServer {
  const server = new McpServer(
    {
      name: 'memoclaw',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  registerTools(server, client);

  return server;
}

/**
 * Start the MCP server with stdio transport.
 */
async function main(): Promise<void> {
  const client = await createClient();
  const server = createServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Only auto-start when run directly as a script (not when imported)
const url = import.meta.url;
const isDirectRun = process.argv[1] && (
  url.endsWith('/dist/index.js') ||
  url.includes('@memoclaw/mcp-server')
);

if (isDirectRun) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
