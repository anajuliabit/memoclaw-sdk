/**
 * Minimal interface for the MemoClaw client used by the MCP server.
 * This avoids a hard compile-time dependency on @memoclaw/sdk,
 * making testing easier with mocks.
 */
export interface MemoClawClientInterface {
  store(request: Record<string, unknown>): Promise<{
    id: string;
    stored: boolean;
    deduplicated: boolean;
    tokens_used: number;
  }>;

  recall(request: Record<string, unknown>): Promise<{
    memories: Array<{
      id: string;
      content: string;
      similarity: number;
      importance: number;
      memory_type: string;
      namespace: string;
      metadata: Record<string, unknown>;
      created_at: string;
    }>;
    query_tokens: number;
  }>;

  list(params?: Record<string, unknown>): Promise<{
    memories: Array<{
      id: string;
      content: string;
      importance: number;
      memory_type: string;
      namespace: string;
      metadata: Record<string, unknown>;
      created_at: string;
      pinned: boolean;
    }>;
    total: number;
    limit: number;
    offset: number;
  }>;

  delete(id: string): Promise<{
    deleted: boolean;
    id: string;
  }>;

  ingest(request: Record<string, unknown>): Promise<{
    memory_ids: string[];
    facts_extracted: number;
    facts_stored: number;
    facts_deduplicated: number;
    relations_created: number;
    tokens_used: number;
  }>;

  status(): Promise<{
    wallet: string;
    free_tier_remaining: number;
    free_tier_total: number;
    free_tier_used: number;
  }>;

  get(id: string): Promise<{
    id: string;
    content: string;
    importance: number;
    memory_type: string;
    namespace: string;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
    accessed_at: string;
    access_count: number;
    pinned: boolean;
    immutable: boolean;
    session_id: string | null;
    agent_id: string | null;
    expires_at: string | null;
  }>;

  update(id: string, request: Record<string, unknown>): Promise<{
    id: string;
    content: string;
    importance: number;
    memory_type: string;
    namespace: string;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
    pinned: boolean;
    immutable: boolean;
  }>;

  assembleContext(request: Record<string, unknown>): Promise<{
    context: string | Record<string, unknown>;
    memories_used: number;
    tokens: number;
  }>;

  textSearch(params: Record<string, unknown>): Promise<{
    memories: Array<{
      id: string;
      content: string;
      importance: number;
      memory_type: string;
      namespace: string;
      metadata: Record<string, unknown>;
      created_at: string;
    }>;
    total: number;
  }>;

  consolidate(request?: Record<string, unknown>): Promise<{
    clusters_found: number;
    memories_merged: number;
    memories_created: number;
    clusters: Array<{
      memory_ids: string[];
      similarity: number;
      merged_into?: string;
    }>;
  }>;

  stats(): Promise<{
    total_memories: number;
    pinned_count: number;
    never_accessed: number;
    total_accesses: number;
    avg_importance: number;
    oldest_memory: string | null;
    newest_memory: string | null;
    by_type: Array<{ memory_type: string; count: number }>;
    by_namespace: Array<{ namespace: string; count: number }>;
  }>;

  listNamespaces(): Promise<{
    namespaces: Array<{
      name: string;
      count: number;
      last_memory_at: string | null;
    }>;
    total: number;
  }>;

  suggested(params?: Record<string, unknown>): Promise<{
    suggested: Array<{
      id: string;
      content: string;
      importance: number;
      memory_type: string;
      namespace: string;
      category: string;
      review_score: number;
      created_at: string;
      accessed_at: string;
      access_count: number;
    }>;
    categories: Record<string, number>;
    total: number;
  }>;
}
