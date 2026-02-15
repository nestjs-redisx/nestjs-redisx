import { describe, it, expect } from 'vitest';
import { CachePlugin } from '../../src/cache.plugin';
import { CACHE_PLUGIN_OPTIONS, CACHE_SERVICE, L1_CACHE_STORE, L2_CACHE_STORE, SERIALIZER, STAMPEDE_PROTECTION, TAG_INDEX, SWR_MANAGER, LUA_SCRIPT_LOADER, INVALIDATION_REGISTRY, EVENT_INVALIDATION_SERVICE } from '../../src/shared/constants';

describe('CachePlugin', () => {
  it('should have correct metadata', () => {
    // Given
    const plugin = new CachePlugin();

    // When/Then
    expect(plugin.name).toBe('cache');
    expect(plugin.version).toBe('0.1.0');
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
});
