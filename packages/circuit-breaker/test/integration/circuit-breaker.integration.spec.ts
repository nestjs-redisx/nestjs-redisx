import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { RedisModule } from '@nestjs-redisx/core';

import { CircuitBreakerPlugin, CIRCUIT_BREAKER_SERVICE, CircuitBreakerOpenError, type ICircuitBreakerService } from '../../src';

/**
 * Integration tests against a LIVE Redis instance on REDIS_HOST:REDIS_PORT
 * (defaults to localhost:6379). Skipped when SKIP_INTEGRATION=true so CI runs
 * the hermetic memory-driver suite instead.
 *
 * Exercises every public method and the key edge cases end-to-end over real
 * Redis (scriptLoad + EVALSHA + Lua), so there is real-Redis parity with the
 * in-memory suite.
 */
const skipIntegration = process.env.SKIP_INTEGRATION === 'true';
const describeIntegration = skipIntegration ? describe.skip : describe;

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);
const OPEN_MS = 300;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describeIntegration('CircuitBreaker (live Redis)', () => {
  let app: TestingModule;
  let cb: ICircuitBreakerService;
  let n = 0;
  const uniqueKey = (): string => `it:${process.pid}:${Date.now()}:${n++}`;

  const ok = (): Promise<string> => Promise.resolve('ok');
  const fail = (): Promise<string> => Promise.reject(new Error('down'));

  beforeAll(async () => {
    app = await Test.createTestingModule({
      imports: [
        RedisModule.forRoot({
          clients: { type: 'single', host: REDIS_HOST, port: REDIS_PORT },
          plugins: [new CircuitBreakerPlugin({ failureThreshold: 2, windowMs: 10000, openDurationMs: OPEN_MS, halfOpenMaxCalls: 1, successThreshold: 1 })],
        }),
      ],
    }).compile();
    await app.init();
    cb = app.get<ICircuitBreakerService>(CIRCUIT_BREAKER_SERVICE);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('runs closed -> open -> half-open -> closed over real Redis Lua', async () => {
    // Given — a fresh CLOSED circuit
    const key = uniqueKey();
    await cb.reset(key);
    await expect(cb.execute(key, ok)).resolves.toBe('ok');

    // When — two failures within the window
    await expect(cb.execute(key, fail)).rejects.toThrow('down');
    await expect(cb.execute(key, fail)).rejects.toThrow('down');

    // Then — OPEN: calls fail fast without running fn
    expect((await cb.getState(key)).state).toBe('open');
    await expect(cb.execute(key, ok)).rejects.toBeInstanceOf(CircuitBreakerOpenError);

    // When — the cooldown elapses (getState is non-mutating: still open)
    await wait(OPEN_MS + 80);
    expect((await cb.getState(key)).state).toBe('open');

    // Then — the next real call probes and, on success, closes the breaker
    await expect(cb.execute(key, ok)).resolves.toBe('ok');
    expect((await cb.getState(key)).state).toBe('closed');
    await cb.reset(key);
  });

  it('supports the manual API: recordFailure/recordSuccess/getState/reset', async () => {
    // Given
    const key = uniqueKey();
    await cb.reset(key);

    // When / Then — two manual failures trip the breaker (threshold = 2)
    expect((await cb.recordFailure(key)).state).toBe('closed');
    expect((await cb.recordFailure(key)).state).toBe('open');
    expect((await cb.getState(key)).state).toBe('open');

    // When / Then — reset returns it to CLOSED
    await cb.reset(key);
    expect((await cb.getState(key)).state).toBe('closed');

    // Then — recordSuccess in CLOSED is a no-op and keeps it closed
    expect((await cb.recordSuccess(key)).state).toBe('closed');
    await cb.reset(key);
  });

  it('returns the fallback instead of throwing while OPEN', async () => {
    // Given — a tripped breaker
    const key = uniqueKey();
    await cb.reset(key);
    await expect(cb.execute(key, fail)).rejects.toThrow();
    await expect(cb.execute(key, fail)).rejects.toThrow();
    expect((await cb.getState(key)).state).toBe('open');

    // When
    const result = await cb.execute(key, ok, { fallback: () => 'fallback' });

    // Then
    expect(result).toBe('fallback');
    await cb.reset(key);
  });

  it('reopens on a failed half-open probe with a fresh cooldown', async () => {
    // Given — a tripped breaker past its cooldown
    const key = uniqueKey();
    await cb.reset(key);
    await expect(cb.execute(key, fail)).rejects.toThrow();
    await expect(cb.execute(key, fail)).rejects.toThrow();
    await wait(OPEN_MS + 80);

    // When — the half-open probe fails
    await expect(cb.execute(key, fail)).rejects.toThrow('down');

    // Then — OPEN again with a fresh cooldown (rejects immediately)
    expect((await cb.getState(key)).state).toBe('open');
    await expect(cb.execute(key, ok)).rejects.toBeInstanceOf(CircuitBreakerOpenError);
    await cb.reset(key);
  });

  it('caps concurrent half-open probes at halfOpenMaxCalls', async () => {
    // Given — a tripped breaker past its cooldown (halfOpenMaxCalls = 1)
    const key = uniqueKey();
    await cb.reset(key);
    await expect(cb.execute(key, fail)).rejects.toThrow();
    await expect(cb.execute(key, fail)).rejects.toThrow();
    await wait(OPEN_MS + 80);

    // When — a deferred probe occupies the single slot

    // `started` resolves only once fn runs — i.e. canRequest committed the
    // slot — so no sleep-based synchronization is needed.
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const probe = cb.execute(key, async () => {
      started();
      await gate;
      return 'probe-ok';
    });
    await startedPromise; // deterministic: the slot is occupied

    // Then — the extra call is rejected while the probe is in flight
    await expect(cb.execute(key, ok)).rejects.toBeInstanceOf(CircuitBreakerOpenError);

    // When — the probe completes successfully
    release();
    await expect(probe).resolves.toBe('probe-ok');

    // Then — the breaker closes
    expect((await cb.getState(key)).state).toBe('closed');
    await cb.reset(key);
  });

  it('does not trip when failures fall outside the window', async () => {
    // Given — a dedicated app with a short (80ms) rolling window
    const shortApp = await Test.createTestingModule({
      imports: [
        RedisModule.forRoot({
          clients: { type: 'single', host: REDIS_HOST, port: REDIS_PORT },
          plugins: [new CircuitBreakerPlugin({ keyPrefix: 'cbwin:', failureThreshold: 2, windowMs: 80, openDurationMs: OPEN_MS, halfOpenMaxCalls: 1, successThreshold: 1 })],
        }),
      ],
    }).compile();
    await shortApp.init();
    const shortCb = shortApp.get<ICircuitBreakerService>(CIRCUIT_BREAKER_SERVICE);
    const key = uniqueKey();
    await shortCb.reset(key);

    // When — two failures spread wider than the window
    await expect(shortCb.execute(key, fail)).rejects.toThrow();
    await wait(120); // first failure ages out of the 80ms window
    await expect(shortCb.execute(key, fail)).rejects.toThrow();

    // Then — only one failure is ever in-window, still CLOSED
    expect((await shortCb.getState(key)).state).toBe('closed');

    await shortCb.reset(key);
    await shortApp.close();
  });
});
