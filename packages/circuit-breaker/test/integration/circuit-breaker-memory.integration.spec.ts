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
