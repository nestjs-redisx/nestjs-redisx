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
    const key = uniqueKey();
    await cb.reset(key);

    await expect(cb.execute(key, ok)).resolves.toBe('ok');
    await expect(cb.execute(key, fail)).rejects.toThrow('down');
    await expect(cb.execute(key, fail)).rejects.toThrow('down');
    expect((await cb.getState(key)).state).toBe('open');

    await expect(cb.execute(key, ok)).rejects.toBeInstanceOf(CircuitBreakerOpenError);
    // getState is non-mutating: still open after cooldown until a real request
    await wait(OPEN_MS + 80);
    expect((await cb.getState(key)).state).toBe('open');

    await expect(cb.execute(key, ok)).resolves.toBe('ok');
    expect((await cb.getState(key)).state).toBe('closed');
    await cb.reset(key);
  });

  it('supports the manual API: recordFailure/recordSuccess/getState/reset', async () => {
    const key = uniqueKey();
    await cb.reset(key);

    expect((await cb.recordFailure(key)).state).toBe('closed');
    expect((await cb.recordFailure(key)).state).toBe('open'); // threshold = 2
    expect((await cb.getState(key)).state).toBe('open');

    await cb.reset(key);
    expect((await cb.getState(key)).state).toBe('closed');

    await wait(0);
    // recordSuccess in closed is a no-op and keeps it closed
    expect((await cb.recordSuccess(key)).state).toBe('closed');
    await cb.reset(key);
  });

  it('returns the fallback instead of throwing while OPEN', async () => {
    const key = uniqueKey();
    await cb.reset(key);
    await expect(cb.execute(key, fail)).rejects.toThrow();
    await expect(cb.execute(key, fail)).rejects.toThrow();
    expect((await cb.getState(key)).state).toBe('open');

    const result = await cb.execute(key, ok, { fallback: () => 'fallback' });
    expect(result).toBe('fallback');
    await cb.reset(key);
  });

  it('reopens on a failed half-open probe with a fresh cooldown', async () => {
    const key = uniqueKey();
    await cb.reset(key);
    await expect(cb.execute(key, fail)).rejects.toThrow();
    await expect(cb.execute(key, fail)).rejects.toThrow();
    await wait(OPEN_MS + 80);

    await expect(cb.execute(key, fail)).rejects.toThrow('down'); // probe fails -> reopen
    expect((await cb.getState(key)).state).toBe('open');
    // still open immediately after reopen
    await expect(cb.execute(key, ok)).rejects.toBeInstanceOf(CircuitBreakerOpenError);
    await cb.reset(key);
  });

  it('caps concurrent half-open probes at halfOpenMaxCalls', async () => {
    const key = uniqueKey();
    await cb.reset(key);
    await expect(cb.execute(key, fail)).rejects.toThrow();
    await expect(cb.execute(key, fail)).rejects.toThrow();
    await wait(OPEN_MS + 80);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const probe = cb.execute(key, async () => {
      await gate;
      return 'probe-ok';
    });
    await wait(20); // let the probe occupy the single slot

    await expect(cb.execute(key, ok)).rejects.toBeInstanceOf(CircuitBreakerOpenError);

    release();
    await expect(probe).resolves.toBe('probe-ok');
    expect((await cb.getState(key)).state).toBe('closed');
    await cb.reset(key);
  });

  it('does not trip when failures fall outside the window', async () => {
    // A dedicated app with a short window.
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

    await expect(shortCb.execute(key, fail)).rejects.toThrow();
    await wait(120); // first failure ages out of the 80ms window
    await expect(shortCb.execute(key, fail)).rejects.toThrow();
    expect((await shortCb.getState(key)).state).toBe('closed');

    await shortCb.reset(key);
    await shortApp.close();
  });
});
