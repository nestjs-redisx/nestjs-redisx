import { describe, it, expect } from 'vitest';
import { LocksPlugin } from '../../src/locks.plugin';
import { LOCKS_PLUGIN_OPTIONS, LOCK_SERVICE, LOCK_STORE } from '../../src/shared/constants';
import { LockService } from '../../src/lock/application/services/lock.service';
import { RedisLockStoreAdapter } from '../../src/lock/infrastructure/adapters/redis-lock-store.adapter';
import type { ILocksPluginOptions } from '../../src/shared/types';

describe('LocksPlugin', () => {
  describe('plugin metadata', () => {
    it('should have correct name', () => {
      // Given/When
      const plugin = new LocksPlugin();

      // Then
      expect(plugin.name).toBe('locks');
    });

    it('should have version', () => {
      // Given/When
      const plugin = new LocksPlugin();

      // Then
      expect(plugin.version).toBe('0.1.0');
    });

    it('should have description', () => {
      // Given/When
      const plugin = new LocksPlugin();

      // Then
      expect(plugin.description).toBe('Distributed locking with auto-renewal and retry strategies');
    });
  });

  describe('default configuration', () => {
    it('should use default configuration when no options provided', () => {
      // Given
      const plugin = new LocksPlugin();

      // When
      const providers = plugin.getProviders();
      const configProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === LOCKS_PLUGIN_OPTIONS);

      // Then
      expect(configProvider).toBeDefined();
      expect((configProvider as any).useValue).toEqual({
        defaultTtl: 30000,
        maxTtl: 300000,
        keyPrefix: '_lock:',
        retry: {
          maxRetries: 3,
          initialDelay: 100,
          maxDelay: 3000,
          multiplier: 2,
        },
        autoRenew: {
          enabled: true,
          intervalFraction: 0.5,
        },
      });
    });

    it('should use default configuration when empty options provided', () => {
      // Given
      const plugin = new LocksPlugin({});

      // When
      const providers = plugin.getProviders();
      const configProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === LOCKS_PLUGIN_OPTIONS);

      // Then
      expect((configProvider as any).useValue.defaultTtl).toBe(30000);
      expect((configProvider as any).useValue.keyPrefix).toBe('_lock:');
    });
  });

  describe('configuration merging', () => {
    it('should override defaultTtl', () => {
      // Given
      const options: ILocksPluginOptions = {
        defaultTtl: 60000,
      };
      const plugin = new LocksPlugin(options);

      // When
      const providers = plugin.getProviders();
      const configProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === LOCKS_PLUGIN_OPTIONS);

      // Then
      expect((configProvider as any).useValue.defaultTtl).toBe(60000);
      expect((configProvider as any).useValue.maxTtl).toBe(300000); // Default preserved
    });

    it('should override keyPrefix', () => {
      // Given
      const options: ILocksPluginOptions = {
        keyPrefix: 'custom:',
      };
      const plugin = new LocksPlugin(options);

      // When
      const providers = plugin.getProviders();
      const configProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === LOCKS_PLUGIN_OPTIONS);

      // Then
      expect((configProvider as any).useValue.keyPrefix).toBe('custom:');
    });

    it('should merge retry options with defaults', () => {
      // Given
      const options: ILocksPluginOptions = {
        retry: {
          maxRetries: 5,
        },
      };
      const plugin = new LocksPlugin(options);

      // When
      const providers = plugin.getProviders();
      const configProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === LOCKS_PLUGIN_OPTIONS);

      // Then
      expect((configProvider as any).useValue.retry).toEqual({
        maxRetries: 5, // Overridden
        initialDelay: 100, // Default
        maxDelay: 3000, // Default
        multiplier: 2, // Default
      });
    });

    it('should merge autoRenew options with defaults', () => {
      // Given
      const options: ILocksPluginOptions = {
        autoRenew: {
          intervalFraction: 0.75,
        },
      };
      const plugin = new LocksPlugin(options);

      // When
      const providers = plugin.getProviders();
      const configProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === LOCKS_PLUGIN_OPTIONS);

      // Then
      expect((configProvider as any).useValue.autoRenew).toEqual({
        enabled: true, // Default
        intervalFraction: 0.75, // Overridden
      });
    });

    it('should override multiple options', () => {
      // Given
      const options: ILocksPluginOptions = {
        defaultTtl: 45000,
        maxTtl: 600000,
        keyPrefix: 'myapp:lock:',
        retry: {
          maxRetries: 10,
          initialDelay: 50,
        },
        autoRenew: {
          enabled: false,
        },
      };
      const plugin = new LocksPlugin(options);

      // When
      const providers = plugin.getProviders();
      const configProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === LOCKS_PLUGIN_OPTIONS);

      // Then
      expect((configProvider as any).useValue).toEqual({
        defaultTtl: 45000,
        maxTtl: 600000,
        keyPrefix: 'myapp:lock:',
        retry: {
          maxRetries: 10,
          initialDelay: 50,
          maxDelay: 3000,
          multiplier: 2,
        },
        autoRenew: {
          enabled: false,
          intervalFraction: 0.5,
        },
      });
    });
  });

  describe('getProviders', () => {
    it('should return configuration provider', () => {
      // Given
      const plugin = new LocksPlugin();

      // When
      const providers = plugin.getProviders();

      // Then
      const configProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === LOCKS_PLUGIN_OPTIONS);
      expect(configProvider).toBeDefined();
      expect((configProvider as any).provide).toBe(LOCKS_PLUGIN_OPTIONS);
    });

    it('should return lock store provider', () => {
      // Given
      const plugin = new LocksPlugin();

      // When
      const providers = plugin.getProviders();

      // Then
      const storeProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === LOCK_STORE);
      expect(storeProvider).toBeDefined();
      expect((storeProvider as any).provide).toBe(LOCK_STORE);
      expect((storeProvider as any).useClass).toBe(RedisLockStoreAdapter);
    });

    it('should return lock service provider', () => {
      // Given
      const plugin = new LocksPlugin();

      // When
      const providers = plugin.getProviders();

      // Then
      const serviceProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === LOCK_SERVICE);
      expect(serviceProvider).toBeDefined();
      expect((serviceProvider as any).provide).toBe(LOCK_SERVICE);
      expect((serviceProvider as any).useClass).toBe(LockService);
    });

    it('should return exactly 5 providers', () => {
      // Given
      const plugin = new LocksPlugin();

      // When
      const providers = plugin.getProviders();

      // Then
      // 3 config/store/service + Reflector + LockDecoratorInitializerService
      expect(providers).toHaveLength(5);
    });
  });

  describe('getExports', () => {
    it('should export lock service', () => {
      // Given
      const plugin = new LocksPlugin();

      // When
      const exports = plugin.getExports();

      // Then
      expect(exports).toContain(LOCK_SERVICE);
    });

    it('should export exactly 1 item', () => {
      // Given
      const plugin = new LocksPlugin();

      // When
      const exports = plugin.getExports();

      // Then
      expect(exports).toHaveLength(1);
    });
  });

  describe('plugin instantiation', () => {
    it('should create plugin with no options', () => {
      // Given/When
      const plugin = new LocksPlugin();

      // Then
      expect(plugin).toBeInstanceOf(LocksPlugin);
      expect(plugin.name).toBe('locks');
    });

    it('should create plugin with partial options', () => {
      // Given/When
      const plugin = new LocksPlugin({
        defaultTtl: 60000,
      });

      // Then
      expect(plugin).toBeInstanceOf(LocksPlugin);
    });

    it('should create plugin with full options', () => {
      // Given/When
      const plugin = new LocksPlugin({
        defaultTtl: 60000,
        maxTtl: 600000,
        keyPrefix: 'test:',
        retry: {
          maxRetries: 5,
          initialDelay: 100,
          maxDelay: 5000,
          multiplier: 3,
        },
        autoRenew: {
          enabled: false,
          intervalFraction: 0.6,
        },
      });

      // Then
      expect(plugin).toBeInstanceOf(LocksPlugin);
    });
  });
});
