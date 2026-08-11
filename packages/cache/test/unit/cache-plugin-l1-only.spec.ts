import { describe, it, expect } from 'vitest';
import type { Provider } from '@nestjs/common';
import { REDIS_DRIVER } from '@nestjs-redisx/core';

import { CachePlugin } from '../../src/cache.plugin';
import { InMemoryL2StoreAdapter } from '../../src/cache/infrastructure/adapters/in-memory-l2-store.adapter';
import { L2RedisStoreAdapter } from '../../src/cache/infrastructure/adapters/l2-redis-store.adapter';
import { CACHE_PLUGIN_OPTIONS, CACHE_REDIS_DRIVER, L2_CACHE_STORE, LUA_SCRIPT_LOADER, TAG_INDEX } from '../../src/shared/constants';
import { CacheConfigError } from '../../src/shared/errors';
import type { CacheMode, ICachePluginOptions } from '../../src/shared/types';
import { InMemoryTagIndexRepository } from '../../src/tags/infrastructure/repositories/in-memory-tag-index.repository';
import { TagIndexRepository } from '../../src/tags/infrastructure/repositories/tag-index.repository';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function byToken(providers: Provider[], token: unknown): any {
  return providers.find((p) => p && typeof p === 'object' && 'provide' in p && (p as { provide: unknown }).provide === token);
}

describe('CachePlugin — l1-only wiring', () => {
  it('swaps L2 store / tag index / driver to in-memory and drops the Lua loader', () => {
    // When
    const providers = new CachePlugin({ mode: 'l1-only' }).getProviders();

    // Then
    expect(byToken(providers, L2_CACHE_STORE).useClass).toBe(InMemoryL2StoreAdapter);
    expect(byToken(providers, TAG_INDEX).useClass).toBe(InMemoryTagIndexRepository);
    expect(byToken(providers, CACHE_REDIS_DRIVER)).toHaveProperty('useValue');
    // Overrides the core REDIS_DRIVER alias so RedisModule does not eagerly connect.
    expect(byToken(providers, REDIS_DRIVER)).toHaveProperty('useValue');
    expect(byToken(providers, LUA_SCRIPT_LOADER)).toBeUndefined();
  });

  it('keeps the Redis-backed providers in the default l1-l2 mode', () => {
    // When
    const providers = new CachePlugin().getProviders();

    // Then
    expect(byToken(providers, L2_CACHE_STORE).useClass).toBe(L2RedisStoreAdapter);
    expect(byToken(providers, TAG_INDEX).useClass).toBe(TagIndexRepository);
    expect(byToken(providers, CACHE_REDIS_DRIVER)).toHaveProperty('useFactory');
    // Does NOT touch the core alias.
    expect(byToken(providers, REDIS_DRIVER)).toBeUndefined();
    expect(byToken(providers, LUA_SCRIPT_LOADER)).toBeDefined();
  });

  it('fails fast on an invalid mode at bootstrap', () => {
    expect(() => new CachePlugin({ mode: 'nope' as unknown as CacheMode }).getProviders()).toThrow(CacheConfigError);
  });

  it('fails fast on l1-only + explicit client at bootstrap', () => {
    const options: ICachePluginOptions = { mode: 'l1-only', client: 'primary' };
    expect(() => new CachePlugin(options).getProviders()).toThrow(/client/);
  });

  describe('registerAsync', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const optionsFactory = (providers: Provider[]): (() => Promise<unknown>) => (byToken(providers, CACHE_PLUGIN_OPTIONS) as any).useFactory;

    it('wires l1-only from the async options (mode is set there, not in useFactory)', async () => {
      // Given async config with mode on the options and connection in the factory
      const providers = CachePlugin.registerAsync({ mode: 'l1-only', useFactory: () => ({ l1: { maxSize: 50 } }) }).getProviders();

      // Then the wiring is l1-only and the resolved options carry the mode
      expect(byToken(providers, L2_CACHE_STORE).useClass).toBe(InMemoryL2StoreAdapter);
      const resolved = (await optionsFactory(providers)()) as ICachePluginOptions;
      expect(resolved.mode).toBe('l1-only');
      expect(resolved.l1?.maxSize).toBe(50);
    });

    it('rejects a mode returned by useFactory that conflicts with the construction mode', async () => {
      // Given the factory tries to introduce a different mode
      const providers = CachePlugin.registerAsync({ mode: 'l1-only', useFactory: () => ({ mode: 'l1-l2' }) }).getProviders();

      // When the options factory resolves — Then it fails fast
      await expect(optionsFactory(providers)()).rejects.toThrow(CacheConfigError);
    });
  });
});
