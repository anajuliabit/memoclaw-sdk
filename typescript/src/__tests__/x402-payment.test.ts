import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoClawClient, PaymentRequiredError } from '../index.js';

const BASE_URL = 'https://api.memoclaw.com';
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

function mockFetch(responses: Array<{ status: number; body?: unknown; ok?: boolean; headers?: Record<string, string> }>): typeof globalThis.fetch {
  let callIndex = 0;
  return vi.fn(async () => {
    const resp = responses[callIndex] ?? responses[responses.length - 1]!;
    callIndex++;
    const rawHeaders = resp.headers ?? {};
    const hdrs = new Map(Object.entries(rawHeaders).map(([k, v]) => [k.toLowerCase(), v]));
    return {
      ok: resp.ok ?? (resp.status >= 200 && resp.status < 300),
      status: resp.status,
      json: async () => resp.body,
      headers: { get: (name: string) => hdrs.get(name.toLowerCase()) ?? null },
    } as Response;
  });
}

describe('x402 automatic payment', () => {
  it('throws PaymentRequiredError on 402 when x402 is not installed', async () => {
    const fetchFn = mockFetch([
      {
        status: 402,
        body: { error: { code: 'PAYMENT_REQUIRED', message: 'Payment required' } },
      },
    ]);

    const client = new MemoClawClient({
      privateKey: TEST_PRIVATE_KEY,
      baseUrl: BASE_URL,
      fetch: fetchFn,
      maxRetries: 0,
    });

    await expect(client.store({ content: 'test memory' })).rejects.toThrow(PaymentRequiredError);
  });

  it('throws PaymentRequiredError on 402 when enableX402 is false', async () => {
    const fetchFn = mockFetch([
      {
        status: 402,
        body: { error: { code: 'PAYMENT_REQUIRED', message: 'Payment required' } },
      },
    ]);

    const client = new MemoClawClient({
      privateKey: TEST_PRIVATE_KEY,
      baseUrl: BASE_URL,
      fetch: fetchFn,
      maxRetries: 0,
      enableX402: false,
    });

    await expect(client.store({ content: 'test memory' })).rejects.toThrow(PaymentRequiredError);
  });

  it('retries with payment headers when x402 payment succeeds', async () => {
    // First call returns 402, second call (with payment headers) succeeds
    const fetchFn = mockFetch([
      {
        status: 402,
        body: { error: { code: 'PAYMENT_REQUIRED', message: 'Payment required' } },
      },
      {
        status: 200,
        ok: true,
        body: { id: 'mem_123', content: 'test memory' },
      },
    ]);

    // Mock the dynamic import of x402
    const originalFunction = globalThis.Function;
    const mockCreatePaymentHeaders = vi.fn().mockResolvedValue({
      'x-payment': 'mock-payment-token',
      'x-payment-chain': 'base',
    });

    // Override Function constructor to intercept the dynamic import
    globalThis.Function = vi.fn().mockReturnValue(() =>
      Promise.resolve({ createPaymentHeaders: mockCreatePaymentHeaders }),
    ) as unknown as FunctionConstructor;

    try {
      const client = new MemoClawClient({
        privateKey: TEST_PRIVATE_KEY,
        baseUrl: BASE_URL,
        fetch: fetchFn,
        maxRetries: 0,
        enableX402: true,
      });

      const result = await client.store({ content: 'test memory' });
      expect(result).toEqual({ id: 'mem_123', content: 'test memory' });

      // Verify fetch was called twice (initial + retry with payment headers)
      expect(fetchFn).toHaveBeenCalledTimes(2);

      // Verify the second call includes payment headers
      const secondCallArgs = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[1];
      const secondCallHeaders = secondCallArgs?.[1]?.headers as Record<string, string>;
      expect(secondCallHeaders).toMatchObject({
        'x-payment': 'mock-payment-token',
        'x-payment-chain': 'base',
      });
    } finally {
      globalThis.Function = originalFunction;
    }
  });

  it('falls through to error when x402 payment retry also fails', async () => {
    // Both 402 responses
    const fetchFn = mockFetch([
      {
        status: 402,
        body: { error: { code: 'PAYMENT_REQUIRED', message: 'Payment required' } },
      },
      {
        status: 402,
        body: { error: { code: 'INSUFFICIENT_FUNDS', message: 'Insufficient funds after payment' } },
      },
    ]);

    const originalFunction = globalThis.Function;
    globalThis.Function = vi.fn().mockReturnValue(() =>
      Promise.resolve({
        createPaymentHeaders: vi.fn().mockResolvedValue({ 'x-payment': 'mock-token' }),
      }),
    ) as unknown as FunctionConstructor;

    try {
      const client = new MemoClawClient({
        privateKey: TEST_PRIVATE_KEY,
        baseUrl: BASE_URL,
        fetch: fetchFn,
        maxRetries: 0,
        enableX402: true,
      });

      await expect(client.store({ content: 'test memory' })).rejects.toThrow(PaymentRequiredError);
      expect(fetchFn).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.Function = originalFunction;
    }
  });

  it('falls through gracefully when x402 createPaymentHeaders throws', async () => {
    const fetchFn = mockFetch([
      {
        status: 402,
        body: { error: { code: 'PAYMENT_REQUIRED', message: 'Payment required' } },
      },
    ]);

    const originalFunction = globalThis.Function;
    globalThis.Function = vi.fn().mockReturnValue(() =>
      Promise.resolve({
        createPaymentHeaders: vi.fn().mockRejectedValue(new Error('Payment creation failed')),
      }),
    ) as unknown as FunctionConstructor;

    try {
      const client = new MemoClawClient({
        privateKey: TEST_PRIVATE_KEY,
        baseUrl: BASE_URL,
        fetch: fetchFn,
        maxRetries: 0,
        enableX402: true,
      });

      await expect(client.store({ content: 'test memory' })).rejects.toThrow(PaymentRequiredError);
      // Only one fetch call — no retry since payment header creation failed
      expect(fetchFn).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.Function = originalFunction;
    }
  });

  it('enableX402 defaults to true', async () => {
    // When x402 is not installed (dynamic import fails), it should still
    // fall through to PaymentRequiredError gracefully
    const fetchFn = mockFetch([
      {
        status: 402,
        body: { error: { code: 'PAYMENT_REQUIRED', message: 'Payment required' } },
      },
    ]);

    const client = new MemoClawClient({
      privateKey: TEST_PRIVATE_KEY,
      baseUrl: BASE_URL,
      fetch: fetchFn,
      maxRetries: 0,
      // enableX402 not set — should default to true
    });

    // x402 is not installed in test env, so it should fail gracefully
    await expect(client.store({ content: 'test memory' })).rejects.toThrow(PaymentRequiredError);
  });

  it('runs after-response hooks on successful x402 retry', async () => {
    const fetchFn = mockFetch([
      {
        status: 402,
        body: { error: { code: 'PAYMENT_REQUIRED', message: 'Payment required' } },
      },
      {
        status: 200,
        ok: true,
        body: { id: 'mem_456', content: 'hooked memory' },
      },
    ]);

    const originalFunction = globalThis.Function;
    globalThis.Function = vi.fn().mockReturnValue(() =>
      Promise.resolve({
        createPaymentHeaders: vi.fn().mockResolvedValue({ 'x-payment': 'mock-token' }),
      }),
    ) as unknown as FunctionConstructor;

    const afterHook = vi.fn();

    try {
      const client = new MemoClawClient({
        privateKey: TEST_PRIVATE_KEY,
        baseUrl: BASE_URL,
        fetch: fetchFn,
        maxRetries: 0,
        enableX402: true,
      });
      client.onAfterResponse(afterHook);

      await client.store({ content: 'hooked memory' });
      expect(afterHook).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.Function = originalFunction;
    }
  });
});
