/**
 * Integration tests for the locks `waitTimeout` option against a real Redis
 * instance.
 *
 * `waitTimeout` bounds the total time `acquire()` will wait for a contended
 * lock. With a small budget the second acquirer should give up quickly instead
 * of exhausting the full retry schedule.
 *
 * Requires a running Redis instance on REDIS_HOST:REDIS_PORT (defaults to
 * localhost:6379). Skipped when SKIP_INTEGRATION=true.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { RedisModule } from '@nestjs-redisx/core';
import Redis from 'ioredis';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { LocksPlugin } from '../../src/locks.plugin';
import { LOCK_SERVICE } from '../../src/shared/constants';
import { LockAcquisitionError } from '../../src/shared/errors';
import type { ILockService } from '../../src/lock/application/ports/lock-service.port';

const skipIntegration = process.env.SKIP_INTEGRATION === 'true';
const describeIntegration = skipIntegration ? describe.skip : describe;

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);

async function flushRedis(): Promise<void> {
  const client = new Redis({ host: REDIS_HOST, port: REDIS_PORT, lazyConnect: true });
  await client.connect();
  await client.flushdb();
  await client.quit();
}

describeIntegration('LocksPlugin — waitTimeout', () => {
  let moduleRef: TestingModule;
  let lockService: ILockService;

  beforeAll(async () => {
    await flushRedis();

    moduleRef = await Test.createTestingModule({
      imports: [
        RedisModule.forRootAsync({
          plugins: [
            // Generous retry schedule so only waitTimeout can cut the wait short.
            new LocksPlugin({ retry: { maxRetries: 50, initialDelay: 50, maxDelay: 200, multiplier: 2 } }),
          ],
          useFactory: () => ({ clients: { type: 'single', host: REDIS_HOST, port: REDIS_PORT } }),
        }),
      ],
    }).compile();

    await moduleRef.init();
    lockService = moduleRef.get<ILockService>(LOCK_SERVICE);
  });

  beforeEach(async () => {
    await flushRedis();
  });

  afterAll(async () => {
    await flushRedis();
    await moduleRef.close();
  });

  it('gives up within roughly the waitTimeout budget for a contended lock', async () => {
    // Given - the lock is already held (auto-renew off so it does not get extended)
    const held = await lockService.acquire('contended', { ttl: 10_000, autoRenew: false });

    // When - a second acquirer waits at most ~300ms
    const start = Date.now();
    let thrown: unknown;
    try {
      await lockService.acquire('contended', { waitTimeout: 300, ttl: 10_000, autoRenew: false });
    } catch (error) {
      thrown = error;
    }
    const elapsed = Date.now() - start;

    // Then - it fails with a timeout, and well before the 50-retry schedule would finish
    expect(thrown).toBeInstanceOf(LockAcquisitionError);
    expect(elapsed).toBeLessThan(1_500);

    await held.release();
  });

  it('acquires immediately when the lock is free regardless of waitTimeout', async () => {
    // When
    const lock = await lockService.acquire('free', { waitTimeout: 100, ttl: 10_000, autoRenew: false });

    // Then
    expect(lock).toBeDefined();
    expect(await lock.isHeld()).toBe(true);

    await lock.release();
  });
});
