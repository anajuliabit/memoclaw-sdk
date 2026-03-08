import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoClawClient } from '../client.js';
import type { Logger, LogLevel, LogFormat } from '../types.js';

const WALLET = '0x1234567890abcdef1234567890abcdef12345678';

describe('Structured Logging', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Logger interface', () => {
    it('accepts a logger with only debug (backward compat)', () => {
      const logger: Logger = { debug: vi.fn() };
      const client = new MemoClawClient({ wallet: WALLET, logger });
      expect(client).toBeDefined();
    });

    it('accepts a logger with all levels', () => {
      const logger: Logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      const client = new MemoClawClient({ wallet: WALLET, logger });
      expect(client).toBeDefined();
    });
  });

  describe('logLevel option', () => {
    it('creates client with logLevel option', () => {
      const levels: LogLevel[] = ['debug', 'info', 'warn', 'error', 'none'];
      for (const level of levels) {
        const client = new MemoClawClient({ wallet: WALLET, logLevel: level });
        expect(client).toBeDefined();
      }
    });

    it('logLevel filters messages below threshold', async () => {
      const logger: Required<Logger> = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      // Set logLevel to 'warn' — debug and info should be suppressed
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ memories: [], total: 0 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
      const client = new MemoClawClient({
        wallet: WALLET,
        logger,
        logLevel: 'warn',
        fetch: mockFetch,
      });
      await client.list();
      // debug and info should NOT have been called (suppressed)
      expect(logger.debug).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
    });

    it('logLevel none suppresses all output', async () => {
      const logger: Required<Logger> = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ memories: [], total: 0 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
      const client = new MemoClawClient({
        wallet: WALLET,
        logger,
        logLevel: 'none',
        fetch: mockFetch,
      });
      await client.list();
      expect(logger.debug).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe('logFormat option', () => {
    it('json format emits to console', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ memories: [], total: 0 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
      const client = new MemoClawClient({
        wallet: WALLET,
        logLevel: 'debug',
        logFormat: 'json',
        fetch: mockFetch,
      });
      await client.list();

      // Should have emitted JSON strings via console.log
      const jsonCalls = consoleSpy.mock.calls.filter(([arg]) => {
        try {
          const parsed = JSON.parse(arg as string);
          return parsed.logger === 'memoclaw';
        } catch {
          return false;
        }
      });
      expect(jsonCalls.length).toBeGreaterThan(0);

      // Verify structured fields
      const firstEntry = JSON.parse(jsonCalls[0][0] as string);
      expect(firstEntry).toHaveProperty('timestamp');
      expect(firstEntry).toHaveProperty('level');
      expect(firstEntry).toHaveProperty('logger', 'memoclaw');
      expect(firstEntry).toHaveProperty('message');

      consoleSpy.mockRestore();
    });

    it('json format includes request metadata on response', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ memories: [], total: 0 }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-request-id': 'req-test-456',
          },
        }),
      );
      const client = new MemoClawClient({
        wallet: WALLET,
        logLevel: 'debug',
        logFormat: 'json',
        fetch: mockFetch,
      });
      await client.list();

      // Find the response log entry (info level, has status)
      const entries = consoleSpy.mock.calls
        .map(([arg]) => { try { return JSON.parse(arg as string); } catch { return null; } })
        .filter((e) => e?.logger === 'memoclaw' && e?.status);

      expect(entries.length).toBeGreaterThan(0);
      const entry = entries[0];
      expect(entry.method).toBe('GET');
      expect(entry.path).toBe('/v1/memories');
      expect(entry.status).toBe(200);
      expect(entry.duration_ms).toBeGreaterThanOrEqual(0);
      expect(entry.request_id).toBe('req-test-456');

      consoleSpy.mockRestore();
    });
  });

  describe('debug option backward compatibility', () => {
    it('debug: true still works without logLevel', async () => {
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ memories: [], total: 0 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
      const client = new MemoClawClient({
        wallet: WALLET,
        debug: true,
        fetch: mockFetch,
      });
      await client.list();
      // Should have logged something via console.debug or console.info
      const totalCalls = debugSpy.mock.calls.length + infoSpy.mock.calls.length;
      expect(totalCalls).toBeGreaterThan(0);
      debugSpy.mockRestore();
      infoSpy.mockRestore();
    });
  });
});
