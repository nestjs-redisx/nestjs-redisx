import { describe, it, expect } from 'vitest';
import { RateLimitPlugin } from '../../src/rate-limit.plugin';
import { version } from '../../package.json';
import { RATE_LIMIT_PLUGIN_OPTIONS, RATE_LIMIT_SERVICE, RATE_LIMIT_STORE, RATE_LIMIT_REDIS_DRIVER } from '../../src/shared/constants';
import { RateLimitService } from '../../src/rate-limit/application/services/rate-limit.service';
import { RedisRateLimitStoreAdapter } from '../../src/rate-limit/infrastructure/adapters/redis-rate-limit-store.adapter';
import { CLIENT_MANAGER, REDIS_CLIENTS_INITIALIZATION } from '@nestjs-redisx/core';
import type { IRateLimitPluginOptions } from '../../src/shared/types';

describe('RateLimitPlugin', () => {
  describe('plugin metadata', () => {
    it('should have correct name', () => {
      // Given/When
      const plugin = new RateLimitPlugin();

      // Then
      expect(plugin.name).toBe('rate-limit');
    });

    it('should have version', () => {
      // Given/When
      const plugin = new RateLimitPlugin();

      // Then
      expect(plugin.version).toBe(version);
    });

    it('should have description', () => {
      // Given/When
      const plugin = new RateLimitPlugin();

      // Then
      expect(plugin.description).toContain('Rate limiting');
    });
  });

  describe('default configuration', () => {
    it('should use default configuration when no options provided', () => {
      // Given
      const plugin = new RateLimitPlugin();

      // When
      const providers = plugin.getProviders();
      const configProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === RATE_LIMIT_PLUGIN_OPTIONS);

      // Then
      expect(configProvider).toBeDefined();
      expect((configProvider as any).useValue).toMatchObject({
        defaultAlgorithm: 'sliding-window',
        defaultPoints: 100,
        defaultDuration: 60,
        keyPrefix: 'rl:',
        defaultKeyExtractor: 'ip',
        includeHeaders: true,
        errorPolicy: 'fail-closed',
      });
    });
  });

  describe('configuration merging', () => {
    it('should override defaultAlgorithm', () => {
      // Given
      const options: IRateLimitPluginOptions = {
        defaultAlgorithm: 'fixed-window',
      };
      const plugin = new RateLimitPlugin(options);

      // When
      const providers = plugin.getProviders();
      const configProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === RATE_LIMIT_PLUGIN_OPTIONS);

      // Then
      expect((configProvider as any).useValue.defaultAlgorithm).toBe('fixed-window');
    });

    it('should override defaultPoints', () => {
      // Given
      const options: IRateLimitPluginOptions = {
        defaultPoints: 200,
      };
      const plugin = new RateLimitPlugin(options);

      // When
      const providers = plugin.getProviders();
      const configProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === RATE_LIMIT_PLUGIN_OPTIONS);

      // Then
      expect((configProvider as any).useValue.defaultPoints).toBe(200);
    });

    it('should merge headers with defaults', () => {
      // Given
      const options: IRateLimitPluginOptions = {
        headers: {
          limit: 'X-Custom-Limit',
        },
      };
      const plugin = new RateLimitPlugin(options);

      // When
      const providers = plugin.getProviders();
      const configProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === RATE_LIMIT_PLUGIN_OPTIONS);

      // Then
      const headers = (configProvider as any).useValue.headers;
      expect(headers.limit).toBe('X-Custom-Limit');
      expect(headers.remaining).toBe('X-RateLimit-Remaining');
      expect(headers.reset).toBe('X-RateLimit-Reset');
    });

    it('should override multiple options', () => {
      // Given
      const options: IRateLimitPluginOptions = {
        defaultAlgorithm: 'token-bucket',
        defaultPoints: 50,
        defaultDuration: 30,
        keyPrefix: 'custom:',
        errorPolicy: 'fail-open',
      };
      const plugin = new RateLimitPlugin(options);

      // When
      const providers = plugin.getProviders();
      const configProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === RATE_LIMIT_PLUGIN_OPTIONS);

      // Then
      const config = (configProvider as any).useValue;
      expect(config.defaultAlgorithm).toBe('token-bucket');
      expect(config.defaultPoints).toBe(50);
      expect(config.defaultDuration).toBe(30);
      expect(config.keyPrefix).toBe('custom:');
      expect(config.errorPolicy).toBe('fail-open');
    });
  });

  describe('getProviders', () => {
    it('should return configuration provider', () => {
      // Given
      const plugin = new RateLimitPlugin();

      // When
      const providers = plugin.getProviders();

      // Then
      const configProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === RATE_LIMIT_PLUGIN_OPTIONS);
      expect(configProvider).toBeDefined();
    });

    it('should return store provider', () => {
      // Given
      const plugin = new RateLimitPlugin();

      // When
      const providers = plugin.getProviders();

      // Then
      const storeProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === RATE_LIMIT_STORE);
      expect(storeProvider).toBeDefined();
      expect((storeProvider as any).useClass).toBe(RedisRateLimitStoreAdapter);
    });

    it('should return service provider', () => {
      // Given
      const plugin = new RateLimitPlugin();

      // When
      const providers = plugin.getProviders();

      // Then
      const serviceProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === RATE_LIMIT_SERVICE);
      expect(serviceProvider).toBeDefined();
      expect((serviceProvider as any).useClass).toBe(RateLimitService);
    });

    it('should return exactly 5 providers', () => {
      // Given
      const plugin = new RateLimitPlugin();

      // When
      const providers = plugin.getProviders();

      // Then
      // Options, Driver, Store, Service, Reflector, RateLimitGuard, ExceptionFilter
      expect(providers).toHaveLength(7);
    });
  });

  describe('getExports', () => {
    it('should export rate limit service', () => {
      // Given
      const plugin = new RateLimitPlugin();

      // When
      const exports = plugin.getExports();

      // Then
      expect(exports).toContain(RATE_LIMIT_SERVICE);
    });

    it('should export exactly 3 items', () => {
      // Given
      const plugin = new RateLimitPlugin();

      // When
      const exports = plugin.getExports();

      // Then
      // Options, Service, RateLimitGuard
      expect(exports).toHaveLength(3);
      expect(exports).toContain(RATE_LIMIT_PLUGIN_OPTIONS);
      expect(exports).toContain(RATE_LIMIT_SERVICE);
    });
  });

  describe('per-plugin client selection', () => {
    it('should include RATE_LIMIT_REDIS_DRIVER provider in getProviders()', () => {
      // Given
      const plugin = new RateLimitPlugin();

      // When
      const providers = plugin.getProviders();
      const driverProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === RATE_LIMIT_REDIS_DRIVER);

      // Then
      expect(driverProvider).toBeDefined();
      expect(driverProvider).toHaveProperty('useFactory');
      expect((driverProvider as any).inject).toContain(CLIENT_MANAGER);
      expect((driverProvider as any).inject).toContain(REDIS_CLIENTS_INITIALIZATION);
      expect((driverProvider as any).inject).toContain(RATE_LIMIT_PLUGIN_OPTIONS);
    });

    it('should use default client name when client option not specified', () => {
      // Given
      const plugin = new RateLimitPlugin();

      // When
      const providers = plugin.getProviders();
      const configProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === RATE_LIMIT_PLUGIN_OPTIONS);

      // Then
      expect((configProvider as any).useValue.client).toBeUndefined();
    });

    it('should pass custom client name through options', () => {
      // Given
      const plugin = new RateLimitPlugin({ client: 'ratelimit-dedicated' });

      // When
      const providers = plugin.getProviders();
      const configProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === RATE_LIMIT_PLUGIN_OPTIONS);

      // Then
      expect((configProvider as any).useValue.client).toBe('ratelimit-dedicated');
    });

    it('should work with registerAsync and preserve client option', async () => {
      // Given
      const plugin = RateLimitPlugin.registerAsync({
        useFactory: () => ({ client: 'async-ratelimit' }),
      });

      // When
      const providers = plugin.getProviders();
      const configProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === RATE_LIMIT_PLUGIN_OPTIONS);
      const config = await (configProvider as any).useFactory();

      // Then
      expect(config.client).toBe('async-ratelimit');
    });

    it('should throw descriptive error when client name is invalid', async () => {
      // Given
      const plugin = new RateLimitPlugin({ client: 'nonexistent' });
      const providers = plugin.getProviders();
      const driverProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === RATE_LIMIT_REDIS_DRIVER);
      const factory = (driverProvider as any).useFactory;
      const mockManager = {
        getClient: () => {
          throw new Error('Client not found');
        },
      };

      // When/Then
      await expect(factory(mockManager, undefined, { client: 'nonexistent' })).rejects.toThrow('RateLimitPlugin: Redis client "nonexistent" not found');
    });
  });
});
