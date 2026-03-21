# Changelog

All notable changes to memoclaw-sdk will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- CrewAI integration with `MemoClawStoreTool` and `MemoClawRecallTool` for Python SDK (#211)

## [1.1.0] - 2026-03-19

### Features
- **Pool health telemetry** — `MemoClaw.pool_health()` / `AsyncMemoClaw.pool_health()` expose active/idle/max connection stats for debugging latency-sensitive workloads (#215)
- **Warm-up toggle** — new `warm_pool` flag (sync constructor + async factory) plus `warm_pool()` helpers to pre-establish TCP/TLS connections (#215)
- **Connection recycling control** — `pool_recycle_seconds` forwards to httpx keepalive expiry so stale sockets are churned proactively (#215)
- **Docs/tests** — README describes the new knobs and regression tests guard warm-up + health reporting behaviors (#215)
- Add memory lifecycle callbacks (on_store/on_recall/on_delete) to Python + TypeScript SDKs (#214)

### Fixes
- Export the onError lifecycle hook for the TypeScript SDK and ensure hooks are awaited before throwing (#214)

### Documentation
- Document lifecycle callback usage in both SDK READMEs (#214)

### Added
- Pydantic AI integration with MemoClaw store/recall tools plus optional dependency extras (#213)

## [1.0.0] - 2026-03-11

### Breaking Changes
- **RecallBuilder return type changed** — `RecallBuilder.execute()` now returns `RecallResponse` instead of raw list (#172)
- **Auth mode changes** — wallet-only auth for free endpoints; signed auth required for paid endpoints (#56, #85, #109)
- **`list_all`/`listAll` deprecated** — replaced by `iter_memories`/`iterMemories` (#40, #41)
- **`delete_namespace` return type** — now returns structured response instead of `None` (#148, #161)

### Features
- **x402 automatic payment support** — both Python and TypeScript SDKs automatically handle x402 micropayments when free tier is exhausted (#166)
- **Server-side memory graph** — `get_memory_graph()`/`getMemoryGraph()` traverses relationships server-side (#172)
- **LangChain integration** — `MemoClawChatMessageHistory` and `MemoClawRetriever` for Python (#101)
- **LlamaIndex integration** — Python integration for LlamaIndex workflows (#135)
- **Async LangChain/LlamaIndex** — async variants of both integration classes (#140)
- **MCP server** — `@memoclaw/mcp-server` with 14 tools for Claude Desktop, Cursor, etc. (#104, #154)
- **Async batch store** — `AsyncBatchStore` for Python with `py.typed` marker (#132)
- **Structured logging** — configurable log levels with structured output (#134)
- **Ping health check** — `ping()` method for connection validation (#133)
- **Per-request timeout** — all methods accept `timeout` / `RequestOptions` (#49, #53, #79)
- **Request cancellation** — `AbortSignal` support in TypeScript SDK (#46, #83)
- **Client-side validation** — content length (8192), importance (0-1), parameter validation (#117, #122, #148, #152)
- **Wallet-only auth for free endpoints** — no signing needed for list, delete, status, etc. (#56, #85)
- **Batch update** — `update_batch()`/`updateBatch()` for up to 100 memories (#43)
- **Text search** — free keyword search endpoint (#45)
- **Core memories** — get high-importance/pinned memories (#45)
- **Context assembly** — `assemble_context()` for LLM prompt construction (#42)
- **Export/import** — `export()`, `iter_export()`, `migrate()`, `migrate_directory()` (#42, #54, #92)
- **Namespaces/stats** — `list_namespaces()`, `stats()`, `delete_namespace()` (#42, #148)
- **Memory history** — `get_history()` for change tracking (#42)
- **Relations** — `create_relation()`, `list_relations()`, `delete_relation()`, `find_related()` (#23, #34)
- **Pin/unpin core memories** — convenience methods for free endpoints (#156)
- **StoreBuilder** — fluent builder pattern for memory creation (#34)
- **RecallBuilder** — fluent builder for recall queries with `.after()` support (#34, #126)
- **Immutable memories** — lock memories from modification (#48)
- **Suggested memories** — proactive memory suggestions (#34)
- **Config file loading** — auto-load from `~/.memoclaw/config.json` (#35)
- **Request ID surfacing** — debug logging with request IDs (#84)
- **Actionable error suggestions** — error messages include fix hints (#57, #59)
- **OpenClaw integration examples** — ready-to-use agent examples (#61)

### Bug Fixes
- Fix RecallBuilder output and User-Agent header (#161)
- Fix tags/metadata merge bug in store operations (#152)
- Fix Python retry on `PoolTimeout` and `SuggestedMemory` type parity (#165)
- Fix endpoint URLs to match API documentation (#171)
- Fix graph helper bugs and missing RequestOptions/timeout (#173, #174)
- Fix `store_batch` tags nesting, `iter_memories` filters, retry jitter (#114)
- Fix Python type and validation improvements (#144)
- Remove dead code `_is_retryable`, add `AsyncMemoClaw.create()` factory (#139)
- Fix batch delete endpoint and builder bugs (#36)
- Fix duplicate fields/methods across SDKs (#47, #100)
- Align response types between Python and TypeScript (#110)
- Add 502/503/504 to error status map, 408 to retryable codes (#74)
- Fix async `migrate_directory` blocking I/O (#78)
- Honor `Retry-After` header in TypeScript retry logic (#44)
- Python test coverage from 71% → 86% (#121)
- Strict mypy mode with all type annotations fixed (#86)
- Security: fix rollup path traversal vulnerability (#82)
- Security: add `.env` to gitignore (#27)

### Integrations
- **LangChain** — `MemoClawChatMessageHistory` + `MemoClawRetriever` (sync & async) (#101, #140)
- **LlamaIndex** — Python integration (sync & async) (#135, #140)
- **MCP Server** — 14 tools: store, recall, list, delete, get, update, context, search, consolidate, stats, namespaces, suggested, ingest, status (#104, #154)

## [0.1.0] - 2026-02-13

### Added
- Python SDK: `MemoClaw` (sync) and `AsyncMemoClaw` (async) clients
- All 14 API endpoints: store, store_batch, recall, list, update, delete, ingest, extract, consolidate, suggested, create_relation, list_relations, delete_relation, status
- Pydantic models for all request/response types
- Free tier wallet auth with automatic x402 payment fallback
- Context manager support (`with MemoClaw() as mc:`)
- TypeScript SDK (moved from monorepo)
