/**
 * MemoClaw middleware / hooks — logging, telemetry, request mutation.
 */
import { MemoClawClient, MemoClawError } from '@memoclaw/sdk';

const client = new MemoClawClient({ wallet: '0xYourWalletAddress' });

// ── Logging middleware ──────────────────────────────────────────────
client.onBeforeRequest((method, path, body) => {
  console.log(`→ ${method} ${path}`, body ? JSON.stringify(body).slice(0, 80) : '');
});

client.onAfterResponse((method, path, data) => {
  console.log(`← ${method} ${path} OK`);
});

client.onError((method, path, err) => {
  console.error(`✗ ${method} ${path}: [${err.code}] ${err.message}`);
});

// ── Auto-namespace injection ────────────────────────────────────────
// Mutate every store request to inject a default namespace
const namespacedClient = new MemoClawClient({ wallet: '0x...' })
  .onBeforeRequest((_method, path, body) => {
    if (path === '/v1/store' && body && typeof body === 'object') {
      return { ...body, namespace: (body as Record<string, unknown>).namespace ?? 'my-app' };
    }
  });

await namespacedClient.store({ content: 'Auto-namespaced!' });

// ── Telemetry / timing ─────────────────────────────────────────────
const timings = new Map<string, number>();

const telemetryClient = new MemoClawClient({ wallet: '0x...' })
  .onBeforeRequest((_method, path) => {
    timings.set(path, Date.now());
  })
  .onAfterResponse((_method, path) => {
    const start = timings.get(path);
    if (start) {
      console.log(`${path} took ${Date.now() - start}ms`);
      timings.delete(path);
    }
  });

await telemetryClient.recall({ query: 'test' });

// ── Batch delete ────────────────────────────────────────────────────
const results = await client.deleteBatch(['mem-1', 'mem-2', 'mem-3']);
console.log(`Deleted ${results.filter(r => r.deleted).length} memories`);

// ── search() alias (Mem0/Pinecone convention) ───────────────────────
const searchResults = await client.search({ query: 'typescript preferences' });
console.log(`Found ${searchResults.memories.length} memories via search()`);
