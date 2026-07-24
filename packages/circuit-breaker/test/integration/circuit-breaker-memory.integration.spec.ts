import { describe, it, expect, afterEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { RedisModule } from '@nestjs-redisx/core';
import { MEMORY_DRIVER_TYPE } from '@nestjs-redisx/testing';

import { CircuitBreakerPlugin, CIRCUIT_BREAKER_SERVICE, CircuitBreakerOpenError, type ICircuitBreakerService } from '../../src';

/**
 * End-to-end validation on the in-memory driver — NO Redis. Exercises the full
 * stack (service -> Lua scripts -> memory Lua interpreter) through production
 * code, driving a complete closed -> open -> half-open -> closed cycle.
 *
 * NOTE: the store adapter reads time via Date.now(), so this test uses small
 * real timings and real waits (⚠ real timers) to cross the OPEN cooldown.
 */
describe('CircuitBreaker on the in-memory driver (no Redis)', () => {
  let app: TestingModule | undefined;

  const OPEN_MS = 150;

  async function boot(): Promise<ICircuitBreakerService> {
    app = await Test.createTestingModule({
      imports: [
        RedisModule.forRoot({
          clients: { type: 'single', host: 'x', port: 1 },
          global: { driver: MEMORY_DRIVER_TYPE },
          plugins: [
            new CircuitBreakerPlugin({
              failureThreshold: 2,
              windowMs: 10000,
              openDurationMs: OPEN_MS,
              halfOpenMaxCalls: 1,
              successThreshold: 1,
            }),
          ],
        }),
      ],
    }).compile();
    await app.init();
    return app.get<ICircuitBreakerService>(CIRCUIT_BREAKER_SERVICE);
  }

  const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)); // ⚠ real timer

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('runs a full closed -> open -> half-open -> closed cycle over Lua', async () => {
    // Given a fresh breaker in CLOSED
    const cb = await boot();
    const key = 'payments-api';
    const ok = (): Promise<string> => Promise.resolve('ok');
    const fail = (): Promise<string> => Promise.reject(new Error('upstream down'));

    // CLOSED: a successful call passes through
    await expect(cb.execute(key, ok)).resolves.toBe('ok');
    expect((await cb.getState(key)).state).toBe('closed');

    // Two failures within the window trip the breaker to OPEN
    await expect(cb.execute(key, fail)).rejects.toThrow('upstream down');
    expect((await cb.getState(key)).state).toBe('closed'); // 1 failure, below threshold
    await expect(cb.execute(key, fail)).rejects.toThrow('upstream down');
    expect((await cb.getState(key)).state).toBe('open'); // threshold reached

    // OPEN: calls are rejected without executing the function
    let executed = false;
    await expect(
      cb.execute(key, () => {
        executed = true;
        return Promise.resolve('should-not-run');
      }),
    ).rejects.toBeInstanceOf(CircuitBreakerOpenError);
    expect(executed).toBe(false);

    // getState is non-mutating: still OPEN even after the cooldown elapses
    await wait(OPEN_MS + 40);
    expect((await cb.getState(key)).state).toBe('open');

    // A call after the cooldown flips OPEN -> HALF_OPEN, runs the probe, and on
    // success closes the breaker.
    await expect(cb.execute(key, ok)).resolves.toBe('ok');
    expect((await cb.getState(key)).state).toBe('closed');

    // CLOSED again: normal traffic flows
    await expect(cb.execute(key, ok)).resolves.toBe('ok');
  });

  it('reopens on a failed half-open probe', async () => {
    // Given a tripped breaker
    const cb = await boot();
    const key = 'flaky-api';
    const fail = (): Promise<string> => Promise.reject(new Error('boom'));

    await expect(cb.execute(key, fail)).rejects.toThrow();
    await expect(cb.execute(key, fail)).rejects.toThrow();
    expect((await cb.getState(key)).state).toBe('open');

    // When the cooldown elapses and the half-open probe fails
    await wait(OPEN_MS + 40);
    await expect(cb.execute(key, fail)).rejects.toThrow('boom');

    // Then the breaker is OPEN again
    expect((await cb.getState(key)).state).toBe('open');
  });

  it('caps concurrent half-open probes at halfOpenMaxCalls (over Lua)', async () => {
    // Given a breaker that allows a single probe and needs one success to close
    app = await Test.createTestingModule({
      imports: [
        RedisModule.forRoot({
          clients: { type: 'single', host: 'x', port: 1 },
          global: { driver: MEMORY_DRIVER_TYPE },
          plugins: [new CircuitBreakerPlugin({ failureThreshold: 1, windowMs: 10000, openDurationMs: OPEN_MS, halfOpenMaxCalls: 1, successThreshold: 1 })],
        }),
      ],
    }).compile();
    await app.init();
    const cb = app.get<ICircuitBreakerService>(CIRCUIT_BREAKER_SERVICE);
    const key = 'probe-cap';

    await expect(cb.execute(key, () => Promise.reject(new Error('down')))).rejects.toThrow();
    expect((await cb.getState(key)).state).toBe('open');
    await wait(OPEN_MS + 40);

    // A deferred probe holds the single slot open while two more calls race in.
    // `started` resolves only once fn runs — i.e. canRequest has already
    // committed the slot — so no sleep-based synchronization is needed.
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

    // The extra calls are rejected while the probe is in-flight.
    await expect(cb.execute(key, () => Promise.resolve('nope'))).rejects.toBeInstanceOf(CircuitBreakerOpenError);
    await expect(cb.execute(key, () => Promise.resolve('nope'))).rejects.toBeInstanceOf(CircuitBreakerOpenError);

    // Release the probe -> success closes the breaker.
    release();
    await expect(probe).resolves.toBe('probe-ok');
    expect((await cb.getState(key)).state).toBe('closed');
  });

  it('requires successThreshold successful probes to close (over Lua)', async () => {
    // Given a breaker needing two successful probes
    app = await Test.createTestingModule({
      imports: [
        RedisModule.forRoot({
          clients: { type: 'single', host: 'x', port: 1 },
          global: { driver: MEMORY_DRIVER_TYPE },
          plugins: [new CircuitBreakerPlugin({ failureThreshold: 1, windowMs: 10000, openDurationMs: OPEN_MS, halfOpenMaxCalls: 2, successThreshold: 2 })],
        }),
      ],
    }).compile();
    await app.init();
    const cb = app.get<ICircuitBreakerService>(CIRCUIT_BREAKER_SERVICE);
    const key = 'two-probes';

    await expect(cb.execute(key, () => Promise.reject(new Error('down')))).rejects.toThrow();
    await wait(OPEN_MS + 40);

    // First probe succeeds -> still half-open (1/2)
    await expect(cb.execute(key, () => Promise.resolve('ok'))).resolves.toBe('ok');
    expect((await cb.getState(key)).state).toBe('half-open');
    expect((await cb.getState(key)).halfOpenSuccesses).toBe(1);

    // Second probe succeeds -> closes
    await expect(cb.execute(key, () => Promise.resolve('ok'))).resolves.toBe('ok');
    expect((await cb.getState(key)).state).toBe('closed');
  });

  it('supports manual recordFailure/recordSuccess/getState (over Lua)', async () => {
    const cb = await boot();
    const key = 'manual';

    // Two manual failures trip the breaker (failureThreshold = 2)
    expect((await cb.recordFailure(key)).state).toBe('closed');
    expect((await cb.recordFailure(key)).state).toBe('open');
    expect((await cb.getState(key)).state).toBe('open');

    // After cooldown, a permitted call recovers via success
    await wait(OPEN_MS + 40);
    await expect(cb.execute(key, () => Promise.resolve('ok'))).resolves.toBe('ok');
    expect((await cb.getState(key)).state).toBe('closed');
  });

  it('does not trip when failures are spread beyond the window (over Lua)', async () => {
    // Given a short window so the first failure ages out before the second
    app = await Test.createTestingModule({
      imports: [
        RedisModule.forRoot({
          clients: { type: 'single', host: 'x', port: 1 },
          global: { driver: MEMORY_DRIVER_TYPE },
          plugins: [new CircuitBreakerPlugin({ failureThreshold: 2, windowMs: 80, openDurationMs: OPEN_MS, halfOpenMaxCalls: 1, successThreshold: 1 })],
        }),
      ],
    }).compile();
    await app.init();
    const cb = app.get<ICircuitBreakerService>(CIRCUIT_BREAKER_SERVICE);
    const key = 'sliding';

    await expect(cb.execute(key, () => Promise.reject(new Error('down')))).rejects.toThrow();
    await wait(120); // first failure ages out of the 80ms window
    await expect(cb.execute(key, () => Promise.reject(new Error('down')))).rejects.toThrow();

    // Only one failure is ever in-window -> still CLOSED
    expect((await cb.getState(key)).state).toBe('closed');
  });

  it('reclaims a zombie probe slot after probeTimeoutMs (over Lua)', async () => {
    // Given — single probe slot; probes expire after 100ms
    const PROBE_TIMEOUT = 100;
    app = await Test.createTestingModule({
      imports: [
        RedisModule.forRoot({
          clients: { type: 'single', host: 'x', port: 1 },
          global: { driver: MEMORY_DRIVER_TYPE },
          plugins: [new CircuitBreakerPlugin({ failureThreshold: 1, windowMs: 10000, openDurationMs: OPEN_MS, halfOpenMaxCalls: 1, successThreshold: 1, probeTimeoutMs: PROBE_TIMEOUT })],
        }),
      ],
    }).compile();
    await app.init();
    const cb = app.get<ICircuitBreakerService>(CIRCUIT_BREAKER_SERVICE);
    const key = 'zombie';

    // Trip and wait out the cooldown
    await expect(cb.execute(key, () => Promise.reject(new Error('down')))).rejects.toThrow();
    await wait(OPEN_MS + 40);

    // When — a zombie probe occupies the slot and NEVER records an outcome
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    void cb.execute(key, async () => {
      started();
      await new Promise(() => undefined); // hangs forever (simulated crash)
      return 'never';
    });
    await startedPromise; // slot committed

    // Then — while the zombie is fresh, further calls are rejected
    await expect(cb.execute(key, () => Promise.resolve('nope'))).rejects.toBeInstanceOf(CircuitBreakerOpenError);

    // When — probeTimeoutMs elapses, the slot is auto-reclaimed
    await wait(PROBE_TIMEOUT + 40);

    // Then — a fresh probe is admitted and, on success, closes the breaker
    await expect(cb.execute(key, () => Promise.resolve('recovered'))).resolves.toBe('recovered');
    expect((await cb.getState(key)).state).toBe('closed');
  });

  it('reset() returns a tripped breaker to CLOSED', async () => {
    // Given a tripped breaker
    const cb = await boot();
    const key = 'resettable';
    const fail = (): Promise<string> => Promise.reject(new Error('boom'));
    await expect(cb.execute(key, fail)).rejects.toThrow();
    await expect(cb.execute(key, fail)).rejects.toThrow();
    expect((await cb.getState(key)).state).toBe('open');

    // When
    await cb.reset(key);

    // Then
    expect((await cb.getState(key)).state).toBe('closed');
  });
});
