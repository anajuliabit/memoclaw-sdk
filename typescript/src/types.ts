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
  /** Ethereum private key for wallet auth. Generates wallet auth header automatically. */
  privateKey?: string;
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
