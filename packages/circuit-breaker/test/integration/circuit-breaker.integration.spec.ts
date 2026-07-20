import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { RedisModule } from '@nestjs-redisx/core';

import { CircuitBreakerPlugin, CIRCUIT_BREAKER_SERVICE, CircuitBreakerOpenError, type ICircuitBreakerService } from '../../src';

/**
 * Integration tests against a LIVE Redis instance on REDIS_HOST:REDIS_PORT
 * (defaults to localhost:6379). Skipped when SKIP_INTEGRATION=true so CI runs
 * the hermetic memory-driver suite instead.
 */
const skipIntegration = process.env.SKIP_INTEGRATION === 'true';
const describeIntegration = skipIntegration ? describe.skip : describe;

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);
const OPEN_MS = 300;

describeIntegration('CircuitBreaker (live Redis)', () => {
  let app: TestingModule;
  let cb: ICircuitBreakerService;

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

  const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  it('runs closed -> open -> half-open -> closed over real Redis Lua', async () => {
    const key = `it:${Date.now()}`;
    await cb.reset(key);

    const ok = (): Promise<string> => Promise.resolve('ok');
    const fail = (): Promise<string> => Promise.reject(new Error('down'));

    await expect(cb.execute(key, ok)).resolves.toBe('ok');

    await expect(cb.execute(key, fail)).rejects.toThrow('down');
    await expect(cb.execute(key, fail)).rejects.toThrow('down');
    expect((await cb.getState(key)).state).toBe('open');

    await expect(cb.execute(key, ok)).rejects.toBeInstanceOf(CircuitBreakerOpenError);

    await wait(OPEN_MS + 80);
    await expect(cb.execute(key, ok)).resolves.toBe('ok');
    expect((await cb.getState(key)).state).toBe('closed');

    await cb.reset(key);
  });
});
