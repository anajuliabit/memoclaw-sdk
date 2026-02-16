/** Memory types with associated decay half-lives */
export type MemoryType = 'correction' | 'preference' | 'decision' | 'project' | 'observation' | 'general';

/** Relation types between memories */
export type RelationType = 'related_to' | 'derived_from' | 'contradicts' | 'supersedes' | 'supports';

// ── Store ──────────────────────────────────────────────

export interface StoreRequest {
  content: string;
  metadata?: { tags?: string[]; [key: string]: unknown };
  importance?: number;
  namespace?: string;
  memory_type?: MemoryType;
  session_id?: string;
  agent_id?: string;
  expires_at?: string;
  pinned?: boolean;
  immutable?: boolean;
}

export interface StoreResponse {
  id: string;
  stored: boolean;
  deduplicated: boolean;
  tokens_used: number;
}

export interface StoreBatchRequest {
  memories: StoreRequest[];
}

export interface StoreBatchResponse {
  ids: string[];
  stored: boolean;
  count: number;
  deduplicated_count: number;
  tokens_used: number;
}

// ── Recall ─────────────────────────────────────────────

export interface RecallRequest {
  query: string;
  limit?: number;
  min_similarity?: number;
  namespace?: string;
  session_id?: string;
  agent_id?: string;
  include_relations?: boolean;
  filters?: {
    tags?: string[];
    after?: string;
    memory_type?: MemoryType;
  };
}

export interface RecallSignals {
  vector: number;
  keyword: number;
  recency: number;
  base_importance: number;
  effective_importance: number;
  context_importance: number;
  relation_count: number;
  type_decay: number;
}

export interface RecallMemory {
  id: string;
  content: string;
  similarity: number;
  metadata: Record<string, unknown>;
  importance: number;
  memory_type: MemoryType;
  namespace: string;
  session_id: string | null;
  agent_id: string | null;
  created_at: string;
  access_count: number;
  pinned: boolean;
  immutable: boolean;
  relations?: RelationWithMemory[];
  _signals?: RecallSignals;
}

export interface RecallResponse {
  memories: RecallMemory[];
  query_tokens: number;
}

// ── Memory ─────────────────────────────────────────────

export interface Memory {
  id: string;
  user_id: string;
  namespace: string;
  content: string;
  embedding_model: string;
  metadata: Record<string, unknown>;
  importance: number;
  memory_type: MemoryType;
  session_id: string | null;
  agent_id: string | null;
  created_at: string;
  updated_at: string;
  accessed_at: string;
  access_count: number;
  deleted_at: string | null;
  expires_at: string | null;
  pinned: boolean;
  immutable: boolean;
}

export interface ListMemoriesResponse {
  memories: Memory[];
  total: number;
  limit: number;
  offset: number;
}

export interface ListMemoriesParams {
  limit?: number;
  offset?: number;
  tags?: string[];
  namespace?: string;
  session_id?: string;
  agent_id?: string;
}

export interface UpdateMemoryRequest {
  content?: string;
  metadata?: Record<string, unknown>;
  importance?: number;
  memory_type?: MemoryType;
  namespace?: string;
  expires_at?: string | null;
  pinned?: boolean;
  immutable?: boolean;
}

// ── Delete ─────────────────────────────────────────────

export interface DeleteResponse {
  deleted: boolean;
  id: string;
}

// ── Ingest ─────────────────────────────────────────────

export interface IngestRequest {
  messages?: { role: string; content: string }[];
  text?: string;
  namespace?: string;
  session_id?: string;
  agent_id?: string;
  auto_relate?: boolean;
}

export interface IngestResponse {
  memory_ids: string[];
  facts_extracted: number;
  facts_stored: number;
  facts_deduplicated: number;
  relations_created: number;
  tokens_used: number;
}

// ── Suggested ──────────────────────────────────────────

export type SuggestedCategory = 'stale' | 'fresh' | 'hot' | 'decaying';

export interface SuggestedMemory {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  importance: number;
  memory_type: MemoryType;
  namespace: string;
  session_id: string | null;
  agent_id: string | null;
  created_at: string;
  accessed_at: string;
  access_count: number;
  relation_count: number;
  category: SuggestedCategory;
  review_score: number;
}

export interface SuggestedParams {
  limit?: number;
  namespace?: string;
  session_id?: string;
  agent_id?: string;
  category?: SuggestedCategory;
}

export interface SuggestedResponse {
  suggested: SuggestedMemory[];
  categories: Record<string, number>;
  total: number;
}

// ── Relations ──────────────────────────────────────────

export interface RelationWithMemory {
  id: string;
  relation_type: RelationType;
  direction: 'outgoing' | 'incoming';
  memory: {
    id: string;
    content: string;
    importance: number;
    memory_type: MemoryType;
    namespace: string;
  };
  metadata: Record<string, unknown>;
  created_at: string;
}

// ── Extract ────────────────────────────────────────────

export interface ExtractRequest {
  messages: { role: string; content: string }[];
  namespace?: string;
  session_id?: string;
  agent_id?: string;
}

export interface ExtractResponse {
  memory_ids: string[];
  facts_extracted: number;
  facts_stored: number;
  facts_deduplicated: number;
  tokens_used: number;
}

// ── Consolidate ────────────────────────────────────────

export interface ConsolidateRequest {
  namespace?: string;
  min_similarity?: number;
  mode?: string;
  dry_run?: boolean;
}

export interface ConsolidateResponse {
  clusters: number;
  merged: number;
  tokens_used: number;
  dry_run: boolean;
  details?: unknown[];
}

// ── Relations (mutations) ──────────────────────────────

export interface CreateRelationRequest {
  target_id: string;
  relation_type: RelationType;
  metadata?: Record<string, unknown>;
}

export interface CreateRelationResponse {
  id: string;
  created: boolean;
}

export interface ListRelationsResponse {
  relations: RelationWithMemory[];
}

export interface DeleteRelationResponse {
  deleted: boolean;
  id: string;
}

// ── Update Batch ───────────────────────────────────────

export interface UpdateBatchItem {
  id: string;
  content?: string;
  metadata?: Record<string, unknown>;
  importance?: number;
  memory_type?: MemoryType;
  namespace?: string;
  pinned?: boolean;
  immutable?: boolean;
  expires_at?: string | null;
}

export interface UpdateBatchRequest {
  updates: UpdateBatchItem[];
}

export interface UpdateBatchResultItem {
  id: string;
  updated: boolean;
  error?: string;
}

export interface UpdateBatchResponse {
  results: UpdateBatchResultItem[];
  updated: number;
  failed: number;
  tokens_used: number;
}

// ── Delete Batch ───────────────────────────────────────

export interface DeleteBatchResult {
  id: string;
  deleted: boolean;
  error?: string;
}

// ── Free Tier Status ───────────────────────────────────

export interface FreeTierStatus {
  wallet: string;
  free_tier_remaining: number;
  free_tier_total: number;
  free_tier_used: number;
}

// ── Migrate ────────────────────────────────────────────

export interface MigrateFile {
  filename: string;
  content: string;
}

export interface MigrateRequest {
  files: MigrateFile[];
  namespace?: string;
  agent_id?: string;
  session_id?: string;
  auto_tag?: boolean;
}

export interface MigrateResponse {
  memory_ids: string[];
  files_processed: number;
  memories_created: number;
  memories_deduplicated: number;
  tokens_used: number;
}

// ── Context ────────────────────────────────────────────

export interface ContextRequest {
  query: string;
  namespace?: string;
  session_id?: string;
  agent_id?: string;
  max_memories?: number;
  max_tokens?: number;
  format?: 'text' | 'structured';
  include_metadata?: boolean;
  summarize?: boolean;
}

export interface ContextResponse {
  context: string | Record<string, unknown>;
  memories_used: number;
  tokens: number;
}

// ── Namespaces ─────────────────────────────────────────

export interface NamespaceInfo {
  name: string;
  count: number;
  last_memory_at: string | null;
}

export interface NamespacesResponse {
  namespaces: NamespaceInfo[];
  total: number;
}

// ── Stats ──────────────────────────────────────────────

export interface TypeCount {
  memory_type: string;
  count: number;
}

export interface NamespaceCount {
  namespace: string;
  count: number;
}

export interface StatsResponse {
  total_memories: number;
  pinned_count: number;
  never_accessed: number;
  total_accesses: number;
  avg_importance: number;
  oldest_memory: string | null;
  newest_memory: string | null;
  by_type: TypeCount[];
  by_namespace: NamespaceCount[];
}

// ── Export ──────────────────────────────────────────────

export interface ExportParams {
  format?: 'json' | 'csv' | 'markdown';
  namespace?: string;
  memory_type?: MemoryType;
  tags?: string[];
  session_id?: string;
  agent_id?: string;
  before?: string;
  after?: string;
  include_deleted?: boolean;
}

export interface ExportResponse {
  format: string;
  memories: unknown[];
  count: number;
}

// ── History ────────────────────────────────────────────

export interface HistoryEntry {
  id: string;
  memory_id: string;
  changes: Record<string, unknown>;
  created_at: string;
}

export interface HistoryResponse {
  history: HistoryEntry[];
}

// ── Core Memories ──────────────────────────────────────

export interface CoreMemoriesParams {
  limit?: number;
  namespace?: string;
  agent_id?: string;
}

export interface CoreMemoriesResponse {
  memories: Memory[];
  total: number;
}

// ── Text Search ────────────────────────────────────────

export interface TextSearchParams {
  query: string;
  limit?: number;
  namespace?: string;
  tags?: string[];
  memory_type?: MemoryType;
  session_id?: string;
  agent_id?: string;
  after?: string;
}

export interface TextSearchResponse {
  memories: Memory[];
  total: number;
}

// ── Errors ─────────────────────────────────────────────

export interface MemoClawErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

// ── Client Options ─────────────────────────────────────

export interface MemoClawOptions {
  /** Base URL of the MemoClaw API (default: https://api.memoclaw.com) */
  baseUrl?: string;
  /** Wallet address for authentication (sent as X-Wallet header).
   *  If omitted, resolved from env MEMOCLAW_WALLET or ~/.memoclaw/config.json. */
  wallet?: string;
  /** Optional fetch implementation (defaults to globalThis.fetch) */
  fetch?: typeof globalThis.fetch;
  /** Maximum number of retries for transient errors (default: 2) */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff (default: 500) */
  retryDelay?: number;
  /** Path to config file (default: ~/.memoclaw/config.json) */
  configPath?: string;
}
