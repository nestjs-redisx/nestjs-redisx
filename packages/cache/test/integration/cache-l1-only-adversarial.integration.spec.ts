/**
 * Adversarial verification of `mode: 'l1-only'` — actively trying to break the
 * core promises rather than just exercising the happy path:
 *
 *  1. NO Redis is ever touched (the driver stays a disconnected null object,
 *     even after every kind of operation, against a dead port).
 *  2. NO value duplication — L1 and the in-memory L2 hold the SAME object
 *     instance, so a large value is stored once, not copied.
 *  3. deleteMany actually clears BOTH tiers in l1-only (no stale L2 entry that
 *     would resurrect a "deleted" key).
 *  4. Glob invalidation treats regex-special characters literally.
 *  5. Singleflight coalesces a FAILING loader: one attempt, everyone rejects.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { RedisModule, REDIS_DRIVER, type IRedisDriver } from '@nestjs-redisx/core';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

import { CachePlugin } from '../../src/cache.plugin';
import type { ICacheService } from '../../src/cache/application/ports/cache-service.port';
import type { IL1CacheStore } from '../../src/cache/application/ports/l1-cache-store.port';
import type { IL2CacheStore } from '../../src/cache/application/ports/l2-cache-store.port';
import { CACHE_REDIS_DRIVER, CACHE_SERVICE, L1_CACHE_STORE, L2_CACHE_STORE } from '../../src/shared/constants';

const DEAD_PORT = 6399; // nothing listens here — any real Redis dial would fail

describe('CachePlugin mode: l1-only — adversarial', () => {
  let app: TestingModule;
  let cache: ICacheService;

  beforeAll(async () => {
    app = await Test.createTestingModule({
      imports: [
        RedisModule.forRoot({
          clients: { type: 'single', host: '127.0.0.1', port: DEAD_PORT },
          plugins: [new CachePlugin({ mode: 'l1-only', l1: { maxSize: 100 }, tags: { enabled: true } })],
        }),
      ],
    }).compile();
    await app.init();
    cache = app.get<ICacheService>(CACHE_SERVICE);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('never connects to Redis — the driver is a disconnected null object before AND after work', async () => {
    // Given the wired drivers
    const cacheDriver = app.get<IRedisDriver>(CACHE_REDIS_DRIVER);
    const coreDriver = app.get<IRedisDriver>(REDIS_DRIVER);

    // Then the plugin overrode the core alias with the same null object...
    expect(cacheDriver).toBe(coreDriver);
    expect(cacheDriver.isConnected()).toBe(false);

    // When every category of operation runs (reads, writes, tags, scan, swr)
    await cache.set('x', 1, { tags: ['t'] });
    await cache.getOrSet('y', async () => 2, { swr: { enabled: true } });
    await cache.getMany(['x', 'y']);
    await cache.invalidateTag('t');
    await cache.invalidateByPattern('*');
    await cache.deleteMany(['x', 'y']);
    await cache.clear();

    // Then the driver STILL reports no connection (nothing ever dialed Redis)
    expect(cacheDriver.isConnected()).toBe(false);
    expect(await cacheDriver.get('anything')).toBeNull();
  });

  it('stores a value ONCE — L1 and the in-memory L2 reference the same instance (no duplication)', async () => {
    // Given a large value
    const big = { blob: 'x'.repeat(100_000) };
    const l1 = app.get<IL1CacheStore>(L1_CACHE_STORE);
    const l2 = app.get<IL2CacheStore>(L2_CACHE_STORE);

    // When it is cached
    await cache.set('dup:1', big);

    // Then both tiers hold the EXACT SAME CacheEntry object (one copy in memory)
    const l1Entry = await l1.get<typeof big>('dup:1');
    const l2Entry = await l2.get<typeof big>('dup:1');
    expect(l1Entry).not.toBeNull();
    expect(l1Entry).toBe(l2Entry);
    expect(l1Entry?.value).toBe(big);
  });

  it('deleteMany clears BOTH tiers — no stale L2 entry resurrects a deleted key', async () => {
    // Given values present in both tiers
    const l2 = app.get<IL2CacheStore>(L2_CACHE_STORE);
    await cache.set('d:1', 'a');
    await cache.set('d:2', 'b');
    expect(await l2.get('d:1')).not.toBeNull();

    // When
    const deleted = await cache.deleteMany(['d:1', 'd:2']);

    // Then both L1 (via cache.get) and the in-memory L2 are empty
    expect(deleted).toBe(2);
    expect(await cache.get('d:1')).toBeNull();
    expect(await l2.get('d:1')).toBeNull();
    expect(await l2.get('d:2')).toBeNull();
  });

  it('treats regex-special characters in a glob pattern literally', async () => {
    // Given keys that would collide if the pattern were used as a raw RegExp
    await cache.set('a.b:1', 1);
    await cache.set('axb:1', 2); // '.' as regex-any would match this too

    // When invalidating with a literal-dot pattern
    const removed = await cache.invalidateByPattern('a.b:*');

    // Then only the literal 'a.b:1' is removed
    expect(removed).toBe(1);
    expect(await cache.get('a.b:1')).toBeNull();
    expect(await cache.get('axb:1')).toBe(2);
  });

  it('coalesces a FAILING loader via singleflight — one attempt, all callers reject', async () => {
    // Given a slow, failing loader
    let attempts = 0;
    const failing = vi.fn().mockImplementation(async () => {
      attempts++;
      await new Promise((r) => setTimeout(r, 30));
      throw new Error('boom');
    });

    // When many callers race for the same cold key
    const settled = await Promise.allSettled(Array.from({ length: 8 }, () => cache.getOrSet('sf:fail', failing)));

    // Then every caller rejected, and the loader ran exactly once (no storm)
    expect(settled.every((s) => s.status === 'rejected')).toBe(true);
    expect(attempts).toBe(1);
  });
});
