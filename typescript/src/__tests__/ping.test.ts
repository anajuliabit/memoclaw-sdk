import { describe, it, expect, vi } from 'vitest';
import { MemoClawClient } from '../index.js';
import type { PingResult } from '../types.js';

const BASE_URL = 'https://api.memoclaw.com';
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_WALLET = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

const FREE_TIER_RESPONSE = {
  wallet: TEST_WALLET,
  free_tier_remaining: 87,
  free_tier_total: 100,
  free_tier_used: 13,
};

function mockFetch(responses: Array<{ status: number; body?: unknown; ok?: boolean }>): typeof globalThis.fetch {
  let callIndex = 0;
  return vi.fn(async () => {
    const resp = responses[callIndex] ?? responses[responses.length - 1]!;
    callIndex++;
    return {
      ok: resp.ok ?? (resp.status >= 200 && resp.status < 300),
      status: resp.status,
      json: async () => resp.body,
      headers: { get: () => null },
    } as unknown as Response;
  });
}

describe('ping()', () => {
  it('returns ok with signed auth mode', async () => {
    const fetchFn = mockFetch([{ status: 200, body: FREE_TIER_RESPONSE }]);
    const client = new MemoClawClient({
      privateKey: TEST_PRIVATE_KEY,
      baseUrl: BASE_URL,
      fetch: fetchFn,
    });

    const result: PingResult = await client.ping();
    expect(result.ok).toBe(true);
    expect(result.auth).toBe('signed');
    expect(result.freeTierRemaining).toBe(87);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns ok with wallet-only auth mode', async () => {
    const fetchFn = mockFetch([{ status: 200, body: FREE_TIER_RESPONSE }]);
    // Temporarily clear env private key to force wallet-only mode
    const origKey = process.env.MEMOCLAW_PRIVATE_KEY;
    delete process.env.MEMOCLAW_PRIVATE_KEY;
    try {
    const client = new MemoClawClient({
      wallet: '0x0000000000000000000000000000000000000001',
      baseUrl: BASE_URL,
      fetch: fetchFn,
    });

    const result = await client.ping();
    expect(result.ok).toBe(true);
    expect(result.auth).toBe('wallet-only');
    expect(result.freeTierRemaining).toBe(87);
    } finally {
      if (origKey !== undefined) process.env.MEMOCLAW_PRIVATE_KEY = origKey;
      else delete process.env.MEMOCLAW_PRIVATE_KEY;
    }
  });

  it('returns ok: false on server error', async () => {
    const fetchFn = mockFetch([{
      status: 500,
      body: { error: { code: 'INTERNAL', message: 'boom' } },
    }]);
    const client = new MemoClawClient({
      privateKey: TEST_PRIVATE_KEY,
      baseUrl: BASE_URL,
      fetch: fetchFn,
      maxRetries: 0,
    });

    const result = await client.ping();
    expect(result.ok).toBe(false);
    expect(result.auth).toBe('signed');
    expect(result.freeTierRemaining).toBe(0);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns ok: false on network error', async () => {
    const fetchFn = vi.fn(async () => { throw new Error('network fail'); }) as unknown as typeof globalThis.fetch;
    const client = new MemoClawClient({
      privateKey: TEST_PRIVATE_KEY,
      baseUrl: BASE_URL,
      fetch: fetchFn,
      maxRetries: 0,
    });

    const result = await client.ping();
    expect(result.ok).toBe(false);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe('MemoClawClient.create()', () => {
  it('creates client without validation by default', async () => {
    const client = await MemoClawClient.create({
      privateKey: TEST_PRIVATE_KEY,
      baseUrl: BASE_URL,
    });
    expect(client).toBeInstanceOf(MemoClawClient);
  });

  it('creates client with successful validation', async () => {
    const fetchFn = mockFetch([{ status: 200, body: FREE_TIER_RESPONSE }]);
    const client = await MemoClawClient.create({
      privateKey: TEST_PRIVATE_KEY,
      baseUrl: BASE_URL,
      fetch: fetchFn,
      validateOnInit: true,
    });
    expect(client).toBeInstanceOf(MemoClawClient);
  });

  it('throws on failed validation', async () => {
    const fetchFn = vi.fn(async () => { throw new Error('network fail'); }) as unknown as typeof globalThis.fetch;
    await expect(
      MemoClawClient.create({
        privateKey: TEST_PRIVATE_KEY,
        baseUrl: BASE_URL,
        fetch: fetchFn,
        maxRetries: 0,
        validateOnInit: true,
      }),
    ).rejects.toThrow('health check failed');
  });
});
