# @memoclaw/mcp-server

MCP (Model Context Protocol) server for [MemoClaw](https://memoclaw.com) — semantic memory for AI agents.

Works with **Claude Desktop**, **Cursor**, **Windsurf**, **Cline**, and any MCP-compatible client.

## Quick Start

```bash
npm install -g @memoclaw/mcp-server @memoclaw/sdk
```

## Configuration

### Claude Desktop

Add to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "memoclaw": {
      "command": "npx",
      "args": ["@memoclaw/mcp-server"],
      "env": {
        "MEMOCLAW_PRIVATE_KEY": "your-private-key"
      }
    }
  }
}
```

### Cursor

Add to Cursor's MCP settings:

```json
{
  "mcpServers": {
    "memoclaw": {
      "command": "npx",
      "args": ["@memoclaw/mcp-server"],
      "env": {
        "MEMOCLAW_PRIVATE_KEY": "your-private-key"
      }
    }
  }
}
```

### Authentication

The server uses the same auth as the MemoClaw SDK:

- **`MEMOCLAW_PRIVATE_KEY`** — Full access with signed requests
- **`MEMOCLAW_WALLET`** — Free endpoints only (read/list/status)
- **`~/.memoclaw/config.json`** — Created by `memoclaw init`

## Available Tools

| Tool | Description | Auth Required |
|------|-------------|---------------|
| `memoclaw_store` | Store a memory with optional importance, tags, namespace | ✅ Private key |
| `memoclaw_recall` | Semantic search across memories | ✅ Private key |
| `memoclaw_list` | List/filter memories with pagination | Wallet only |
| `memoclaw_delete` | Delete a memory by ID | Wallet only |
| `memoclaw_ingest` | Auto-extract memories from conversation/text | ✅ Private key |
| `memoclaw_status` | Check free tier usage | Wallet only |

### memoclaw_store

Store a memory in MemoClaw.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `content` | string | ✅ | Memory text (max 8192 chars) |
| `importance` | number | | Score from 0.0 to 1.0 |
| `tags` | string[] | | Tags for filtering |
| `namespace` | string | | Namespace to isolate memories |
| `memory_type` | string | | One of: correction, preference, decision, project, observation, general |
| `pinned` | boolean | | Pin to prevent decay |
| `immutable` | boolean | | Lock from modification |

### memoclaw_recall

Semantic search across stored memories.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | ✅ | Search query |
| `limit` | number | | Max results (1-50) |
| `namespace` | string | | Filter by namespace |
| `tags` | string[] | | Filter by tags |
| `min_similarity` | number | | Minimum similarity (0-1) |
| `memory_type` | string | | Filter by type |

### memoclaw_list

List memories with pagination and filters.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | number | | Max results (1-100) |
| `offset` | number | | Pagination offset |
| `namespace` | string | | Filter by namespace |
| `tags` | string[] | | Filter by tags |
| `memory_type` | string | | Filter by type |

### memoclaw_delete

Delete a memory by ID (soft delete).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | ✅ | Memory ID |

### memoclaw_ingest

Auto-extract memories from conversation or text.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `text` | string | | Raw text to extract from |
| `messages` | array | | Conversation messages `[{role, content}]` |
| `namespace` | string | | Namespace for extracted memories |
| `auto_relate` | boolean | | Auto-create relations |

### memoclaw_status

Check free tier usage. No parameters required.

## Programmatic Usage

You can also use the server programmatically:

```typescript
import { createServer, registerTools } from '@memoclaw/mcp-server';
import { MemoClawClient } from '@memoclaw/sdk';

// With default client (from env/config)
const server = createServer(new MemoClawClient());

// Or bring your own client
const client = new MemoClawClient({ privateKey: '0x...' });
const server = createServer(client);
```

## Links

- [MemoClaw Documentation](https://docs.memoclaw.com)
- [TypeScript SDK](https://www.npmjs.com/package/@memoclaw/sdk)
- [Python SDK](https://pypi.org/project/memoclaw/)
- [GitHub](https://github.com/anajuliabit/memoclaw-sdk)

## License

MIT
