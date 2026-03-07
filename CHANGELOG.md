# Changelog

All notable changes to memoclaw-sdk will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- **MCP Server** (`@memoclaw/mcp-server`): New package exposing MemoClaw operations as MCP tools
  - `memoclaw_store` — Store memories with importance, tags, namespace
  - `memoclaw_recall` — Semantic search across memories
  - `memoclaw_list` — List/filter memories with pagination
  - `memoclaw_delete` — Delete memories by ID
  - `memoclaw_ingest` — Auto-extract memories from conversation/text
  - `memoclaw_status` — Check free tier usage
  - Compatible with Claude Desktop, Cursor, Windsurf, and any MCP client
  - Uses stdio transport (standard for MCP)
  - Auth via env vars or ~/.memoclaw/config.json
- CI: Added MCP server test job for Node 18/20/22

## [0.1.0] - 2026-02-13

### Added
- Python SDK: `MemoClaw` (sync) and `AsyncMemoClaw` (async) clients
- All 14 API endpoints: store, store_batch, recall, list, update, delete, ingest, extract, consolidate, suggested, create_relation, list_relations, delete_relation, status
- Pydantic models for all request/response types
- Free tier wallet auth with automatic x402 payment fallback
- Context manager support (`with MemoClaw() as mc:`)
- TypeScript SDK (moved from monorepo)
