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
}
