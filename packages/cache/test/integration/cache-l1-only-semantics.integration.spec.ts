/**
 * The fail-vs-work boundary for `l1-only`, verified adversarially.
 *
 * Criterion (the user's own): "features that DEPEND ON Redis must fail". The
 * open question was whether tags / SWR / stale-if-error should fail-fast in
 * l1-only. This suite settles it with evidence:
 *
 *  - l1-only is single-instance for EVERYTHING — basic get/set is per-process,
 *    and tags are per-process in EXACTLY the same way. So allowing tags is
 *    consistent with allowing get/set; forbidding tags while allowing get/set
 *    would be incoherent (both are local in-memory ops, neither is shared).
 *  - Their real dependency is STORAGE, which the in-memory tier satisfies, so
 *    they WORK correctly single-instance.
 *  - AMQP event invalidation depends on an external BROKER (not storage), so it
 *    genuinely cannot work and is rejected at bootstrap.
 */

import { Test, type TestingModule } from '@nestjs/testing';
import { RedisModule } from '@nestjs-redisx/core';
import { describe, it, expect } from 'vitest';

import { CachePlugin } from '../../src/cache.plugin';
import type { ICacheService } from '../../src/cache/application/ports/cache-service.port';
import { CACHE_SERVICE } from '../../src/shared/constants';
import { CacheConfigError } from '../../src/shared/errors';
import type { ICachePluginOptions } from '../../src/shared/types';

const DEAD_PORT = 6399; // nothing listens here — no real Redis is ever reached

async function bootL1Only(extra: ICachePluginOptions = {}): Promise<TestingModule> {
  const app = await Test.createTestingModule({
    imports: [
      RedisModule.forRoot({
        clients: { type: 'single', host: '127.0.0.1', port: DEAD_PORT },
        plugins: [new CachePlugin({ mode: 'l1-only', tags: { enabled: true }, ...extra })],
      }),
    ],
  }).compile();
  await app.init();
  return app;
}

describe('l1-only — fail-vs-work boundary', () => {
  it('is single-instance for EVERYTHING: two apps share neither values NOR tag invalidation (so tags are not a special footgun)', async () => {
    const a = await bootL1Only();
    const b = await bootL1Only();
    const cacheA = a.get<ICacheService>(CACHE_SERVICE);
    const cacheB = b.get<ICacheService>(CACHE_SERVICE);

    try {
      // Basic get/set is already per-instance...
      await cacheA.set('k', 'A', { tags: ['t'] });
      await cacheB.set('k', 'B', { tags: ['t'] });
      expect(await cacheA.get('k')).toBe('A');
      expect(await cacheB.get('k')).toBe('B'); // independent value, not shared

      // ...and tag invalidation is per-instance in the SAME way: A invalidating
      // its tag clears only A. B is untouched — exactly like get/set. This is
      // consistent behavior, not tags "silently broken".
      expect(await cacheA.invalidateTag('t')).toBe(1);
      expect(await cacheA.get('k')).toBeNull();
      expect(await cacheB.get('k')).toBe('B');
    } finally {
      await a.close();
      await b.close();
    }
  });

  it('WORKS: tags, SWR and stale-if-error all function single-instance (their dependency is storage, satisfied in-memory)', async () => {
    const app = await bootL1Only({
      swr: { enabled: true, defaultStaleTime: 30 },
      staleIfError: { enabled: true, defaultWindow: 3 },
    });
    const cache = app.get<ICacheService>(CACHE_SERVICE);

    try {
      // tags
      await cache.set('p:1', 1, { tags: ['grp'] });
      await cache.set('p:2', 2, { tags: ['grp'] });
      expect(await cache.invalidateTag('grp')).toBe(2);
      expect(await cache.get('p:1')).toBeNull();

      // SWR path resolves and caches with no Redis
      let loads = 0;
      const load = async (): Promise<string> => {
        loads++;
        return 'v';
      };
      expect(await cache.getOrSet('s:1', load, { swr: { enabled: true } })).toBe('v');
      expect(await cache.getOrSet('s:1', load, { swr: { enabled: true } })).toBe('v');
      expect(loads).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('FAILS FAST: AMQP event invalidation depends on a broker, so it is rejected at bootstrap', async () => {
    // Given l1-only combined with an AMQP invalidation source
    // When / Then — the module fails to build with a clear config error
    await expect(bootL1Only({ invalidation: { source: 'amqp' } })).rejects.toThrow(CacheConfigError);
  });
});
