import { describe, it, expect, vi } from 'vitest';
import { MemoClawClient } from '../index.js';
import type { FreeTierInfo, SessionAuthResponse } from '../types.js';

const BASE_URL = 'https://api.memoclaw.com';
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_WALLET = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

const FREE_TIER_INFO_RESPONSE: FreeTierInfo = {
  free_tier: {
    enabled: true,
    calls_per_wallet: 100,
    description: 'Every wallet gets 100 free API calls. No payment required.',
  },
  auth: {
    header: 'x-wallet-auth',
    format: '{wallet_address}:{unix_timestamp}:{signature}',
    message_to_sign: 'memoclaw-auth:{unix_timestamp}',
    expiry_seconds: 300,
  },
  after_free_tier: {
    payment: 'x402 (USDC on Base)',
    note: 'Only endpoints using OpenAI are charged. See /reference/pricing for details.',
  },
};

const SESSION_RESPONSE: SessionAuthResponse = {
  token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test',
  wallet: TEST_WALLET,
  expires_at: '2026-03-19T14:00:00Z',
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

describe('freeTierInfo()', () => {
  it('returns free tier policy info', async () => {
    const fetchFn = mockFetch([{ status: 200, body: FREE_TIER_INFO_RESPONSE }]);
    const client = new MemoClawClient({
      privateKey: TEST_PRIVATE_KEY,
      baseUrl: BASE_URL,
      fetch: fetchFn,
    });

    const info = await client.freeTierInfo();
    expect(info.free_tier.enabled).toBe(true);
    expect(info.free_tier.calls_per_wallet).toBe(100);
    expect(info.auth.header).toBe('x-wallet-auth');
    expect(info.after_free_tier.payment).toContain('x402');
  });

  it('calls the correct endpoint', async () => {
    const fetchFn = mockFetch([{ status: 200, body: FREE_TIER_INFO_RESPONSE }]);
    const client = new MemoClawClient({
      privateKey: TEST_PRIVATE_KEY,
      baseUrl: BASE_URL,
      fetch: fetchFn,
    });

    await client.freeTierInfo();
    expect(fetchFn).toHaveBeenCalledWith(
      `${BASE_URL}/v1/free-tier/info`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('works with wallet-only auth', async () => {
    const fetchFn = mockFetch([{ status: 200, body: FREE_TIER_INFO_RESPONSE }]);
    const origKey = process.env.MEMOCLAW_PRIVATE_KEY;
    delete process.env.MEMOCLAW_PRIVATE_KEY;
    try {
      const client = new MemoClawClient({
        wallet: TEST_WALLET,
        baseUrl: BASE_URL,
        fetch: fetchFn,
      });
      const info = await client.freeTierInfo();
      expect(info.free_tier.enabled).toBe(true);
    } finally {
      if (origKey !== undefined) process.env.MEMOCLAW_PRIVATE_KEY = origKey;
    }
  });
});

describe('createSession()', () => {
  it('returns a JWT session token', async () => {
    const fetchFn = mockFetch([{ status: 200, body: SESSION_RESPONSE }]);
    const client = new MemoClawClient({
      privateKey: TEST_PRIVATE_KEY,
      baseUrl: BASE_URL,
      fetch: fetchFn,
    });

    const session = await client.createSession();
    expect(session.token).toBe(SESSION_RESPONSE.token);
    expect(session.wallet).toBe(TEST_WALLET);
    expect(session.expires_at).toBe('2026-03-19T14:00:00Z');
  });

  it('sends correct request body', async () => {
    const fetchFn = mockFetch([{ status: 200, body: SESSION_RESPONSE }]);
    const client = new MemoClawClient({
      privateKey: TEST_PRIVATE_KEY,
      baseUrl: BASE_URL,
      fetch: fetchFn,
    });

    await client.createSession();
    expect(fetchFn).toHaveBeenCalledWith(
      `${BASE_URL}/auth/session`,
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"address"'),
      }),
    );

    // Verify the body contains required fields
    const call = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse(call[1].body as string);
    expect(body.address).toBe(TEST_WALLET);
    expect(typeof body.timestamp).toBe('number');
    expect(typeof body.signature).toBe('string');
    expect(body.signature).toMatch(/^0x/);
  });

  it('throws when using wallet-only auth', async () => {
    const fetchFn = mockFetch([{ status: 200, body: SESSION_RESPONSE }]);
    const origKey = process.env.MEMOCLAW_PRIVATE_KEY;
    delete process.env.MEMOCLAW_PRIVATE_KEY;
    try {
      const client = new MemoClawClient({
        wallet: TEST_WALLET,
        baseUrl: BASE_URL,
        fetch: fetchFn,
      });
      await expect(client.createSession()).rejects.toThrow(/private key/i);
    } finally {
      if (origKey !== undefined) process.env.MEMOCLAW_PRIVATE_KEY = origKey;
    }
  });
});
