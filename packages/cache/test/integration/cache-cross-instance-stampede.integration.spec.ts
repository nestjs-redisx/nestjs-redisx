/**
 * Cross-instance stampede coordination against a real Redis instance.
 *
 * Boots TWO independent Nest applications (two CacheService instances, two
 * separate stampede flight maps) sharing one Redis. While instance A holds the
 * distributed stampede lock and loads, instance B must WAIT for the lock to
 * clear and serve the value A cached — without running its own loader.
 *
 * Requires a running Redis instance on REDIS_HOST:REDIS_PORT (defaults to
 * localhost:6379). Skipped when SKIP_INTEGRATION=true.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { RedisModule } from '@nestjs-redisx/core';
import Redis from 'ioredis';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

import { CachePlugin } from '../../src/cache.plugin';
import { CACHE_SERVICE } from '../../src/shared/constants';
import type { ICacheService } from '../../src/cache/application/ports/cache-service.port';

const skipIntegration = process.env.SKIP_INTEGRATION === 'true';
const describeIntegration = skipIntegration ? describe.skip : describe;

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);
// Isolated Redis DB so parallel integration files never flush each other's keys.
const REDIS_DB = 2;

async function flushRedis(): Promise<void> {
  const client = new Redis({ host: REDIS_HOST, port: REDIS_PORT, db: REDIS_DB, lazyConnect: true });
  await client.connect();
  await client.flushdb();
  await client.quit();
}

async function bootApp(): Promise<TestingModule> {
  const module = await Test.createTestingModule({
    imports: [
      RedisModule.forRootAsync({
        plugins: [new CachePlugin({ l1: { enabled: false } })],
        useFactory: () => ({ clients: { type: 'single', host: REDIS_HOST, port: REDIS_PORT, db: REDIS_DB } }),
      }),
    ],
  }).compile();
  await module.init();
  return module;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describeIntegration('CachePlugin — cross-instance stampede coordination', () => {
  let appA: TestingModule;
  let appB: TestingModule;
  let cacheA: ICacheService;
  let cacheB: ICacheService;

  beforeAll(async () => {
    await flushRedis();
    appA = await bootApp();
    appB = await bootApp();
    cacheA = appA.get<ICacheService>(CACHE_SERVICE);
    cacheB = appB.get<ICacheService>(CACHE_SERVICE);
  });

  afterAll(async () => {
    await flushRedis();
    await appA.close();
    await appB.close();
  });

  it('instance B waits for instance A and serves its value without loading', async () => {
    // Given — instance A starts a slow load (holds the distributed lock; the
    // cache write happens inside the protected section, before lock release)
    const slowLoader = vi.fn(async () => {
      await wait(400);
      return 'A-value';
    });
    const promiseA = cacheA.getOrSet('shared:key', slowLoader);

    // When — instance B asks for the same key while A is still loading
    await wait(100); // A holds the lock by now
    const loaderB = vi.fn(async () => 'B-value');
    const valueB = await cacheB.getOrSet('shared:key', loaderB);

    // Then — B waited for A's lock, recheckd the cache, and reused A's value;
    // B's loader never ran (the load happened exactly once across instances)
    expect(await promiseA).toBe('A-value');
    expect(valueB).toBe('A-value');
    expect(loaderB).not.toHaveBeenCalled();
    expect(slowLoader).toHaveBeenCalledTimes(1);
  });

  it('instance B loads itself when the leader cached nothing (unless)', async () => {
    // Given — A loads but `unless` suppresses the cache write
    const promiseA = cacheA.getOrSet(
      'shared:empty',
      async () => {
        await wait(300);
        return 'suppressed';
      },
      { unless: () => true },
    );

    // When — B waits for the lock, finds no cached value, and loads itself
    await wait(100);
    const valueB = await cacheB.getOrSet('shared:empty', async () => 'B-own');

    // Then
    expect(await promiseA).toBe('suppressed');
    expect(valueB).toBe('B-own');
  });
});
