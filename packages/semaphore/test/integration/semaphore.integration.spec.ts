/**
 * Live-Redis integration tests (parity with the memory suite).
 *
 * Requires a running Redis instance on REDIS_HOST:REDIS_PORT (defaults to
 * localhost:6379). Skipped when SKIP_INTEGRATION=true.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { RedisModule } from '@nestjs-redisx/core';

import { SemaphorePlugin, SemaphoreService, SEMAPHORE_SERVICE, SEMAPHORE_STORE, SemaphoreAcquisitionError, type ISemaphoreService, type ISemaphoreStore } from '../../src';

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);
const SKIP = process.env.SKIP_INTEGRATION === 'true';

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(SKIP)('SemaphorePlugin on live Redis', () => {
  let app: TestingModule;
  let serviceA: ISemaphoreService;
  let serviceB: SemaphoreService;
  const run = `${process.pid}-${Date.now()}`; // unique keys per run - shared server

  const key = (name: string): string => `it:${run}:${name}`;

  beforeEach(async () => {
    app = await Test.createTestingModule({
      imports: [
        RedisModule.forRoot({
          clients: { type: 'single', host: REDIS_HOST, port: REDIS_PORT },
          plugins: [new SemaphorePlugin({ retry: { maxRetries: 10, initialDelay: 10, maxDelay: 20, multiplier: 1 } })],
        }),
      ],
    }).compile();
    await app.init();

    serviceA = app.get<ISemaphoreService>(SEMAPHORE_SERVICE);
    serviceB = new SemaphoreService({ retry: { maxRetries: 0, initialDelay: 10, maxDelay: 10, multiplier: 1 }, autoRenew: { enabled: false } }, app.get<ISemaphoreStore>(SEMAPHORE_STORE));
  });

  afterEach(async () => {
    await app.close();
  });

  it('should enforce capacity across two service instances over live Redis', async () => {
    // Given
    const p1 = await serviceA.acquire(key('jobs'), 2, { ttl: 5_000 });
    const p2 = await serviceA.acquire(key('jobs'), 2, { ttl: 5_000 });

    // When/Then
    expect(await serviceB.tryAcquire(key('jobs'), 2)).toBeNull();
    expect(await serviceB.usedPermits(key('jobs'))).toBe(2);

    await p1.release();
    const third = await serviceB.tryAcquire(key('jobs'), 2);
    expect(third).not.toBeNull();

    await p2.release();
    await third!.release();
  });

  it('should sweep an expired holder and let a waiter in (crash recovery)', async () => {
    // Given - short-lease holder that never releases
    await serviceA.acquire(key('crashy'), 1, { ttl: 150, autoRenew: false });

    // When
    await wait(200);

    // Then
    const takeover = await serviceB.tryAcquire(key('crashy'), 1);
    expect(takeover).not.toBeNull();
    await takeover!.release();
  });

  it('should keep a holder seated via auto-renewal past the original TTL', async () => {
    // Given
    const permit = await serviceA.acquire(key('long'), 1, { ttl: 200 });

    // When
    await wait(500);

    // Then
    expect(await permit.isHeld()).toBe(true);
    await permit.release();
  });

  it('should respect the waitTimeout budget under contention', async () => {
    // Given
    const permit = await serviceA.acquire(key('budget'), 1);

    // When/Then
    await expect(serviceB.acquire(key('budget'), 1, { waitTimeout: 30 })).rejects.toThrow(SemaphoreAcquisitionError);

    await permit.release();
  });

  it('should run withPermit under the bound and release on both paths', async () => {
    // Given/When
    const value = await serviceA.withPermit(key('wp'), 1, async () => 'ok');
    await expect(serviceA.withPermit(key('wp'), 1, async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');

    // Then - both executions released their seats
    expect(value).toBe('ok');
    expect(await serviceA.usedPermits(key('wp'))).toBe(0);
  });

  it('should leave no residue: the semaphore key expires with its longest permit', async () => {
    // Given - one short-lived permit, never released
    await serviceA.acquire(key('residue'), 1, { ttl: 150, autoRenew: false });

    // When - past the TTL, nobody touches the key again
    await wait(400);

    // Then - the key itself is gone (key-level PEXPIRE hygiene)
    expect(await serviceA.usedPermits(key('residue'))).toBe(0);
  });
});
