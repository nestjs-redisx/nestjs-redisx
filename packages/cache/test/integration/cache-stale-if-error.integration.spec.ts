/**
 * Integration tests for stale-if-error against a real Redis instance.
 *
 * Lifecycle under test (real timings, real Redis TTLs):
 *   staleAt = now + ttl -> expiresAt (= staleAt when SWR off) -> keepUntil
 * Between expiresAt and keepUntil the value is retained ONLY for serving when
 * the loader fails; the success path treats that range as a normal miss.
 *
 * Requires a running Redis instance on REDIS_HOST:REDIS_PORT (defaults to
 * localhost:6379). Skipped when SKIP_INTEGRATION=true.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { RedisModule } from '@nestjs-redisx/core';
import Redis from 'ioredis';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

import { CachePlugin } from '../../src/cache.plugin';
import { CACHE_SERVICE } from '../../src/shared/constants';
import type { ICacheService } from '../../src/cache/application/ports/cache-service.port';

const skipIntegration = process.env.SKIP_INTEGRATION === 'true';
const describeIntegration = skipIntegration ? describe.skip : describe;

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);
// Isolated Redis DB so parallel integration files never flush each other's keys.
const REDIS_DB = 3;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describeIntegration('Cache stale-if-error (live Redis)', () => {
  let app: TestingModule;
  let cache: ICacheService;
  let redis: Redis;

  beforeAll(async () => {
    app = await Test.createTestingModule({
      imports: [
        RedisModule.forRoot({
          clients: { type: 'single', host: REDIS_HOST, port: REDIS_PORT, db: REDIS_DB },
          plugins: [
            new CachePlugin({
              l1: { enabled: false },
              staleIfError: { enabled: true, defaultWindow: 3, shouldServe: (error) => !error.message.includes('404') },
            }),
          ],
        }),
      ],
    }).compile();
    await app.init();
    cache = app.get<ICacheService>(CACHE_SERVICE);
    redis = new Redis({ host: REDIS_HOST, port: REDIS_PORT, db: REDIS_DB });
  });

  beforeEach(async () => {
    const keys = await redis.keys('cache:sie:*');
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    await app?.close();
    redis?.disconnect();
  });

  it('retains the entry past its expiry (Redis TTL covers ttl + window)', async () => {
    // Given / When
    await cache.getOrSet('sie:ttl-check', async () => 'v1', { ttl: 1 });

    // Then — physical TTL is ~1s (ttl) + 3s (window), not just 1s
    const ttl = await redis.ttl('cache:sie:ttl-check');
    expect(ttl).toBeGreaterThan(2);
    expect(ttl).toBeLessThanOrEqual(4);
  });

  it('serves the last known value on loader failure, then recovers with a healthy loader', async () => {
    // Given
    await cache.getOrSet('sie:report', async () => 'v1', { ttl: 1 });
    await sleep(1100); // past expiry, inside the window

    // When — the upstream fails
    const failing = vi.fn().mockRejectedValue(new Error('503 upstream down'));
    const served = await cache.getOrSet('sie:report', failing, { ttl: 1 });

    // Then — stale-on-error, exactly one loader attempt (no retry storm)
    expect(served).toBe('v1');
    expect(failing).toHaveBeenCalledTimes(1);

    // And the moment the upstream heals, fresh data wins (expired = miss)
    const recovered = await cache.getOrSet('sie:report', async () => 'v2', { ttl: 1 });
    expect(recovered).toBe('v2');
  });

  it('honors shouldServe: a 404 is NOT served stale (data is gone for good)', async () => {
    // Given
    await cache.getOrSet('sie:resource', async () => 'v1', { ttl: 1 });
    await sleep(1100);

    // When / Then
    await expect(cache.getOrSet('sie:resource', vi.fn().mockRejectedValue(new Error('404 not found')), { ttl: 1 })).rejects.toThrow('404');
  });

  it('rethrows once the window has fully passed (key evicted by Redis)', async () => {
    // Given — ttl 1s + window 3s => retention ~4s
    await cache.getOrSet('sie:gone', async () => 'v1', { ttl: 1 });

    // When
    await sleep(4300);
    expect(await redis.exists('cache:sie:gone')).toBe(0);

    // Then
    await expect(cache.getOrSet('sie:gone', vi.fn().mockRejectedValue(new Error('still down')), { ttl: 1 })).rejects.toThrow('still down');
  }, 10000);
});
