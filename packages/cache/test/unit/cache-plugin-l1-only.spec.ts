import { describe, it, expect, vi } from 'vitest';
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

  describe('l1-l2 driver provider + imports', () => {
    it('driver factory resolves the named client from the manager', async () => {
      // Given the default (l1-l2) wiring with a named client
      const provider = byToken(new CachePlugin({ client: 'primary' }).getProviders(), CACHE_REDIS_DRIVER);
      const fakeDriver = { isConnected: () => true };
      const manager = { getClient: vi.fn().mockResolvedValue(fakeDriver) };

      // When the driver factory runs
      const result = await provider.useFactory(manager, undefined, { client: 'primary' });

      // Then it resolves the named client
      expect(manager.getClient).toHaveBeenCalledWith('primary');
      expect(result).toBe(fakeDriver);
    });

    it('driver factory rethrows a clear error when the client is not found', async () => {
      // Given the default client and a manager that cannot resolve it
      const provider = byToken(new CachePlugin().getProviders(), CACHE_REDIS_DRIVER);
      const manager = { getClient: vi.fn().mockRejectedValue(new Error('missing')) };

      // When / Then
      await expect(provider.useFactory(manager, undefined, {})).rejects.toThrow(/Redis client "default" not found/);
    });

    it('getImports returns [] by default and the async imports when provided', () => {
      class DummyModule {}
      expect(new CachePlugin().getImports()).toEqual([]);
      const plugin = CachePlugin.registerAsync({ imports: [DummyModule], useFactory: () => ({}) });
      expect(plugin.getImports()).toEqual([DummyModule]);
    });
  });
});
