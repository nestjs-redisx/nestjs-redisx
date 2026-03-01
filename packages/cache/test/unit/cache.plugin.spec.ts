import { describe, it, expect } from 'vitest';
import { CachePlugin } from '../../src/cache.plugin';
import { version } from '../../package.json';
import { CACHE_PLUGIN_OPTIONS, CACHE_REDIS_DRIVER, CACHE_SERVICE, L1_CACHE_STORE, L2_CACHE_STORE, SERIALIZER, STAMPEDE_PROTECTION, TAG_INDEX, SWR_MANAGER, LUA_SCRIPT_LOADER, INVALIDATION_REGISTRY, EVENT_INVALIDATION_SERVICE } from '../../src/shared/constants';
import { CLIENT_MANAGER, REDIS_CLIENTS_INITIALIZATION } from '@nestjs-redisx/core';

describe('CachePlugin', () => {
  it('should have correct metadata', () => {
    // Given
    const plugin = new CachePlugin();

    // When/Then
    expect(plugin.name).toBe('cache');
    expect(plugin.version).toBe(version);
    expect(plugin.description).toContain('caching');
  });

  describe('getProviders', () => {
    it('should return all required providers', () => {
      // Given
      const plugin = new CachePlugin();

      // When
      const providers = plugin.getProviders();

      // Then
      expect(providers).toBeDefined();
      expect(Array.isArray(providers)).toBe(true);
      expect(providers.length).toBeGreaterThan(0);

      // Check for essential providers
      const providerTokens = providers.map((p) => (typeof p === 'object' && 'provide' in p ? p.provide : null)).filter(Boolean);

      expect(providerTokens).toContain(CACHE_PLUGIN_OPTIONS);
      expect(providerTokens).toContain(CACHE_SERVICE);
      expect(providerTokens).toContain(L1_CACHE_STORE);
      expect(providerTokens).toContain(L2_CACHE_STORE);
      expect(providerTokens).toContain(SERIALIZER);
    });

    it('should merge user options with defaults', () => {
      // Given
      const userOptions = {
        l1: { enabled: false },
        l2: { ttl: 3600 },
      };
      const plugin = new CachePlugin(userOptions);

      // When
      const providers = plugin.getProviders();

      // Then
      const configProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === CACHE_PLUGIN_OPTIONS);
      expect(configProvider).toBeDefined();
      expect(configProvider).toHaveProperty('useValue');

      const config = (configProvider as any).useValue;
      expect(config.l1.enabled).toBe(false);
      expect(config.l2.ttl).toBe(3600);
    });

    it('should provide default config when no options given', () => {
      // Given
      const plugin = new CachePlugin();

      // When
      const providers = plugin.getProviders();

      // Then
      const configProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === CACHE_PLUGIN_OPTIONS);

      const config = (configProvider as any).useValue;
      expect(config).toBeDefined();
      expect(config.l1).toBeDefined();
      expect(config.l2).toBeDefined();
      expect(config.stampede).toBeDefined();
    });
  });

  describe('getExports', () => {
    it('should export cache service and module options', () => {
      // Given
      const plugin = new CachePlugin();

      // When
      const exports = plugin.getExports();

      // Then
      expect(exports).toBeDefined();
      expect(Array.isArray(exports)).toBe(true);
      expect(exports).toContain(CACHE_PLUGIN_OPTIONS);
      expect(exports).toContain(CACHE_SERVICE);
      expect(exports.length).toBe(5);
    });
  });

  describe('getImports', () => {
    it('should return empty array by default', () => {
      // Given
      const plugin = new CachePlugin();

      // When
      const imports = plugin.getImports?.() || [];

      // Then
      expect(Array.isArray(imports)).toBe(true);
      expect(imports.length).toBe(0);
    });
  });

  describe('configuration options', () => {
    it('should accept l1 cache configuration', () => {
      // Given
      const options = {
        l1: {
          enabled: true,
          max: 1000,
          ttl: 60000,
        },
      };

      // When
      const plugin = new CachePlugin(options);
      const providers = plugin.getProviders();

      // Then
      const configProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === CACHE_PLUGIN_OPTIONS);
      const config = (configProvider as any).useValue;
      expect(config.l1.enabled).toBe(true);
      expect(config.l1.max).toBe(1000);
      expect(config.l1.ttl).toBe(60000);
    });

    it('should accept l2 cache configuration', () => {
      // Given
      const options = {
        l2: {
          enabled: true,
          ttl: 3600,
          keyPrefix: 'custom:',
        },
      };

      // When
      const plugin = new CachePlugin(options);
      const providers = plugin.getProviders();

      // Then
      const configProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === CACHE_PLUGIN_OPTIONS);
      const config = (configProvider as any).useValue;
      expect(config.l2.enabled).toBe(true);
      expect(config.l2.ttl).toBe(3600);
    });

    it('should accept stampede protection configuration', () => {
      // Given
      const options = {
        stampede: {
          enabled: true,
          lockTimeout: 10000,
        },
      };

      // When
      const plugin = new CachePlugin(options);
      const providers = plugin.getProviders();

      // Then
      const configProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === CACHE_PLUGIN_OPTIONS);
      const config = (configProvider as any).useValue;
      expect(config.stampede.enabled).toBe(true);
      expect(config.stampede.lockTimeout).toBe(10000);
    });

    it('should accept tags configuration', () => {
      // Given
      const options = {
        tags: {
          enabled: true,
          maxTagsPerKey: 10,
        },
      };

      // When
      const plugin = new CachePlugin(options);
      const providers = plugin.getProviders();

      // Then
      const configProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === CACHE_PLUGIN_OPTIONS);
      const config = (configProvider as any).useValue;
      expect(config.tags.enabled).toBe(true);
    });

    it('should accept invalidation configuration with rules', () => {
      // Given
      const options = {
        invalidation: {
          enabled: true,
          rules: [
            {
              event: 'user.created',
              invalidateTags: ['users'],
            },
            {
              event: 'order.placed',
              invalidateTags: ['orders', 'user-orders'],
            },
          ],
        },
      };

      // When
      const plugin = new CachePlugin(options);
      const providers = plugin.getProviders();

      // Then
      const configProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === CACHE_PLUGIN_OPTIONS);
      const config = (configProvider as any).useValue;
      expect(config.invalidation?.enabled).toBe(true);
      expect(config.invalidation?.rules).toHaveLength(2);
      expect(config.invalidation?.rules?.[0].event).toBe('user.created');
    });

    it('should handle empty invalidation rules', () => {
      // Given
      const options = {
        invalidation: {
          enabled: true,
          rules: [],
        },
      };

      // When
      const plugin = new CachePlugin(options);
      const providers = plugin.getProviders();

      // Then
      const configProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === CACHE_PLUGIN_OPTIONS);
      const config = (configProvider as any).useValue;
      expect(config.invalidation?.rules).toEqual([]);
    });
  });

  describe('per-plugin client selection', () => {
    it('should include CACHE_REDIS_DRIVER provider in getProviders()', () => {
      // Given
      const plugin = new CachePlugin();

      // When
      const providers = plugin.getProviders();
      const driverProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === CACHE_REDIS_DRIVER);

      // Then
      expect(driverProvider).toBeDefined();
      expect(driverProvider).toHaveProperty('useFactory');
      expect((driverProvider as any).inject).toContain(CLIENT_MANAGER);
      expect((driverProvider as any).inject).toContain(REDIS_CLIENTS_INITIALIZATION);
      expect((driverProvider as any).inject).toContain(CACHE_PLUGIN_OPTIONS);
    });

    it('should use default client name when client option not specified', () => {
      // Given
      const plugin = new CachePlugin();

      // When
      const providers = plugin.getProviders();
      const configProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === CACHE_PLUGIN_OPTIONS);

      // Then
      expect((configProvider as any).useValue.client).toBeUndefined();
    });

    it('should pass custom client name through options', () => {
      // Given
      const plugin = new CachePlugin({ client: 'cache-dedicated' });

      // When
      const providers = plugin.getProviders();
      const configProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === CACHE_PLUGIN_OPTIONS);

      // Then
      expect((configProvider as any).useValue.client).toBe('cache-dedicated');
    });

    it('should work with registerAsync and preserve client option', async () => {
      // Given
      const plugin = CachePlugin.registerAsync({
        useFactory: () => ({ client: 'async-cache' }),
      });

      // When
      const providers = plugin.getProviders();
      const configProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === CACHE_PLUGIN_OPTIONS);
      const config = await (configProvider as any).useFactory();

      // Then
      expect(config.client).toBe('async-cache');
    });

    it('should throw descriptive error when client name is invalid', async () => {
      // Given
      const plugin = new CachePlugin({ client: 'nonexistent' });
      const providers = plugin.getProviders();
      const driverProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === CACHE_REDIS_DRIVER);
      const factory = (driverProvider as any).useFactory;
      const mockManager = {
        getClient: () => {
          throw new Error('Client not found');
        },
      };

      // When/Then
      await expect(factory(mockManager, undefined, { client: 'nonexistent' })).rejects.toThrow('CachePlugin: Redis client "nonexistent" not found');
    });
  });
});
