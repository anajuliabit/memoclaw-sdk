# Changelog

All notable changes to memoclaw-sdk will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-02-13

### Added
- Python SDK: `MemoClaw` (sync) and `AsyncMemoClaw` (async) clients
- All 14 API endpoints: store, store_batch, recall, list, update, delete, ingest, extract, consolidate, suggested, create_relation, list_relations, delete_relation, status
- Pydantic models for all request/response types
- Free tier wallet auth with automatic x402 payment fallback
- Context manager support (`with MemoClaw() as mc:`)
- TypeScript SDK (moved from monorepo)
