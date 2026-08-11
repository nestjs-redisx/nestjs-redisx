/**
 * End-to-end coverage for `mode: 'l1-only'` — the cache running with NO Redis.
 *
 * The app is booted pointing at a DEAD Redis port (nothing listens there). If
 * anything tried to open a connection the boot (or the first operation) would
 * hang/fail; instead every feature must work purely in local memory:
 * get/set, getOrSet + singleflight, getMany/setMany, ttl, tags + invalidation,
 * invalidateByPattern, SWR, and stale-if-error.
 *
 * Runs everywhere (no external dependency) — deliberately NOT gated by
 * SKIP_INTEGRATION, and uses a dead port so it can never reach a real Redis.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { RedisModule } from '@nestjs-redisx/core';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

import { CachePlugin } from '../../src/cache.plugin';
import type { ICacheService } from '../../src/cache/application/ports/cache-service.port';
import { CACHE_SERVICE } from '../../src/shared/constants';

// A port nothing listens on — proves l1-only never dials Redis.
const DEAD_PORT = 6399;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('CachePlugin mode: l1-only (no Redis)', () => {
  let app: TestingModule;
  let cache: ICacheService;

  beforeAll(async () => {
    app = await Test.createTestingModule({
      imports: [
        RedisModule.forRoot({
          clients: { type: 'single', host: '127.0.0.1', port: DEAD_PORT },
          plugins: [
            new CachePlugin({
              mode: 'l1-only',
              l1: { maxSize: 100 },
              swr: { enabled: true, defaultStaleTime: 1 },
              staleIfError: { enabled: true, defaultWindow: 3 },
              tags: { enabled: true },
            }),
          ],
        }),
      ],
    }).compile();
    // If l1-only leaked a connection attempt, init() would fail against the dead port.
    await app.init();
    cache = app.get<ICacheService>(CACHE_SERVICE);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('boots with no reachable Redis and does basic get/set', async () => {
    // Given / When
    await cache.set('u:1', { id: 1, name: 'Ada' });

    // Then
    expect(await cache.get('u:1')).toEqual({ id: 1, name: 'Ada' });
    expect(await cache.get('missing')).toBeNull();
    expect(await cache.has('u:1')).toBe(true);
  });

  it('stores each value once — no L1/L2 duplication (same object reference)', async () => {
    // Given a large-ish object
    const big = { blob: 'x'.repeat(1000), n: 42 };

    // When
    await cache.set('big:1', big);
    const a = await cache.get<typeof big>('big:1');
    const b = await cache.get<typeof big>('big:1');

    // Then — l1-only shares the live object across tiers (not a serialized copy)
    expect(a).toBe(b);
    expect(a).toBe(big);
  });

  it('getOrSet loads once and caches', async () => {
    // Given
    const loader = vi.fn().mockResolvedValue('loaded');

    // When
    const first = await cache.getOrSet('go:1', loader);
    const second = await cache.getOrSet('go:1', loader);

    // Then
    expect(first).toBe('loaded');
    expect(second).toBe('loaded');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent getOrSet via in-process singleflight', async () => {
    // Given a slow loader
    const loader = vi.fn().mockImplementation(async () => {
      await sleep(50);
      return 'once';
    });

    // When 20 callers race for the same cold key
    const results = await Promise.all(Array.from({ length: 20 }, () => cache.getOrSet('sf:1', loader)));

    // Then — exactly one load, everyone gets the value
    expect(results.every((r) => r === 'once')).toBe(true);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('supports getMany / setMany / ttl / delete / deleteMany / clear', async () => {
    // Given
    await cache.setMany([
      { key: 'm:1', value: 'a' },
      { key: 'm:2', value: 'b' },
    ]);

    // Then — getMany
    expect(await cache.getMany(['m:1', 'm:2', 'm:3'])).toEqual(['a', 'b', null]);

    // ttl reflects a positive remaining lifetime
    await cache.set('ttl:1', 'v', { ttl: 100 });
    const ttl = await cache.ttl('ttl:1');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(100);

    // delete + deleteMany
    expect(await cache.delete('m:1')).toBe(true);
    expect(await cache.get('m:1')).toBeNull();
    expect(await cache.deleteMany(['m:2', 'nope'])).toBe(1);

    // clear
    await cache.set('c:1', 'v');
    await cache.clear();
    expect(await cache.get('c:1')).toBeNull();
  });

  it('supports tags: invalidateTag drops every tagged key from memory', async () => {
    // Given three keys, two sharing a tag
    await cache.set('p:1', 'one', { tags: ['group'] });
    await cache.set('p:2', 'two', { tags: ['group'] });
    await cache.set('p:3', 'three', { tags: ['other'] });

    expect((await cache.getKeysByTag('group')).length).toBe(2);

    // When
    const invalidated = await cache.invalidateTag('group');

    // Then — tagged keys gone, untagged survives
    expect(invalidated).toBe(2);
    expect(await cache.get('p:1')).toBeNull();
    expect(await cache.get('p:2')).toBeNull();
    expect(await cache.get('p:3')).toBe('three');
  });

  it('supports invalidateByPattern (in-memory scan)', async () => {
    // Given
    await cache.set('user:1:profile', 'a');
    await cache.set('user:2:profile', 'b');
    await cache.set('post:1', 'c');

    // When
    const removed = await cache.invalidateByPattern('user:*');

    // Then
    expect(removed).toBe(2);
    expect(await cache.get('user:1:profile')).toBeNull();
    expect(await cache.get('post:1')).toBe('c');
  });

  it('supports SWR: serves fresh, then serves stale while revalidating', async () => {
    // Given a value cached with a 1s stale window
    let version = 1;
    const loader = vi.fn().mockImplementation(async () => `v${version}`);
    expect(await cache.getOrSet('swr:1', loader, { ttl: 1, swr: { enabled: true, staleTime: 5 } })).toBe('v1');

    // When it becomes stale and is read again
    await sleep(1100);
    version = 2;
    const stale = await cache.getOrSet('swr:1', loader, { ttl: 1, swr: { enabled: true, staleTime: 5 } });

    // Then — stale value is served immediately (background refresh kicks off)
    expect(stale).toBe('v1');

    // And after the background revalidation completes, the fresh value is present
    await sleep(50);
    expect(await cache.getOrSet('swr:1', loader, { ttl: 1, swr: { enabled: true, staleTime: 5 } })).toBe('v2');
  });

  it('supports stale-if-error: serves the last value when the loader fails', async () => {
    // Given a value cached with SWR disabled per-call (so it fully EXPIRES at
    // its ttl rather than entering the stale-while-revalidate window), just
    // past its TTL but inside the stale-if-error window.
    await cache.getOrSet('sie:1', async () => 'good', { ttl: 1, swr: { enabled: false } });
    await sleep(1100);

    // When the (foreground) loader fails
    const failing = vi.fn().mockRejectedValue(new Error('503 down'));
    const served = await cache.getOrSet('sie:1', failing, { ttl: 1, swr: { enabled: false } });

    // Then — the last known value is served, loader attempted exactly once
    expect(served).toBe('good');
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it('reports stats for the in-memory tier', async () => {
    // Given / When
    await cache.set('s:1', 'v');
    await cache.get('s:1'); // hit
    await cache.get('s:absent'); // miss

    // Then
    const stats = await cache.getStats();
    expect(stats.l1.hits + stats.l2.hits).toBeGreaterThan(0);
  });
});
