import { describe, it, expect } from 'vitest';
import { CLIENT_MANAGER, REDIS_CLIENTS_INITIALIZATION } from '@nestjs-redisx/core';
import { LeaderPlugin } from '../../src/leader.plugin';
import { version } from '../../package.json';
import { LEADER_PLUGIN_OPTIONS, LEADER_SERVICE, LEADER_STORE, LEADER_REDIS_DRIVER } from '../../src/shared/constants';
import { LeaderService } from '../../src/leader/application/services/leader.service';
import { RedisLeaderStoreAdapter } from '../../src/leader/infrastructure/adapters/redis-leader-store.adapter';
import { LeaderDecoratorInitializerService } from '../../src/leader/application/services/leader-decorator-initializer.service';
import { InvalidLeaderConfigError } from '../../src/shared/errors';

function findProvider(providers: unknown[], token: unknown): any {
  return providers.find((p) => typeof p === 'object' && p !== null && 'provide' in p && (p as { provide: unknown }).provide === token);
}

describe('LeaderPlugin', () => {
  describe('plugin metadata', () => {
    it('should expose name, version, and description', () => {
      // Given
      const plugin = new LeaderPlugin();

      // Then
      expect(plugin.name).toBe('leader');
      expect(plugin.version).toBe(version);
      expect(plugin.description).toContain('Leader election');
    });
  });

  describe('default configuration', () => {
    it('should merge defaults into the options provider', () => {
      // Given
      const plugin = new LeaderPlugin();

      // When
      const providers = plugin.getProviders();
      const config = findProvider(providers, LEADER_PLUGIN_OPTIONS).useValue;

      // Then
      expect(config).toMatchObject({
        keyPrefix: 'leader:',
        ttlMs: 15_000,
        renewIntervalMs: 5_000,
        retryIntervalMs: 2_000,
        groups: [],
      });
    });

    it('should preserve user overrides', () => {
      // Given
      const plugin = new LeaderPlugin({ ttlMs: 30_000, renewIntervalMs: 10_000, groups: ['reports'], instanceId: 'api-1' });

      // When
      const config = findProvider(plugin.getProviders(), LEADER_PLUGIN_OPTIONS).useValue;

      // Then
      expect(config.ttlMs).toBe(30_000);
      expect(config.renewIntervalMs).toBe(10_000);
      expect(config.groups).toEqual(['reports']);
      expect(config.instanceId).toBe('api-1');
    });
  });

  describe('getProviders', () => {
    it('should register options, driver, store, service, and the decorator initializer', () => {
      // Given
      const plugin = new LeaderPlugin();

      // When
      const providers = plugin.getProviders();

      // Then
      expect(providers).toHaveLength(5);
      expect(findProvider(providers, LEADER_STORE).useClass).toBe(RedisLeaderStoreAdapter);
      expect(findProvider(providers, LEADER_SERVICE).useClass).toBe(LeaderService);
      expect(providers).toContain(LeaderDecoratorInitializerService);
    });

    it('should register the per-plugin Redis driver factory', () => {
      // Given
      const plugin = new LeaderPlugin();

      // When
      const driverProvider = findProvider(plugin.getProviders(), LEADER_REDIS_DRIVER);

      // Then
      expect(driverProvider.useFactory).toBeDefined();
      expect(driverProvider.inject).toContain(CLIENT_MANAGER);
      expect(driverProvider.inject).toContain(REDIS_CLIENTS_INITIALIZATION);
      expect(driverProvider.inject).toContain(LEADER_PLUGIN_OPTIONS);
    });

    it('should throw a descriptive error when the named client does not exist', async () => {
      // Given
      const plugin = new LeaderPlugin({ client: 'missing' });
      const factory = findProvider(plugin.getProviders(), LEADER_REDIS_DRIVER).useFactory;
      const manager = {
        getClient: () => {
          throw new Error('not found');
        },
      };

      // When/Then
      await expect(factory(manager, undefined, { client: 'missing' })).rejects.toThrow('LeaderPlugin: Redis client "missing" not found');
    });
  });

  describe('getExports', () => {
    it('should export the options and the service', () => {
      // Given
      const plugin = new LeaderPlugin();

      // When
      const exports = plugin.getExports();

      // Then
      expect(exports).toHaveLength(2);
      expect(exports).toContain(LEADER_PLUGIN_OPTIONS);
      expect(exports).toContain(LEADER_SERVICE);
    });
  });

  describe('options validation (fail-fast)', () => {
    it('should reject an invalid ttlMs at construction time', () => {
      // When/Then
      expect(() => new LeaderPlugin({ ttlMs: 0 }).getProviders()).toThrow(InvalidLeaderConfigError);
    });

    it('should reject renewIntervalMs >= ttlMs', () => {
      // When/Then
      expect(() => new LeaderPlugin({ ttlMs: 5000, renewIntervalMs: 5000 }).getProviders()).toThrow(InvalidLeaderConfigError);
    });

    it('should reject invalid group names', () => {
      // When/Then
      expect(() => new LeaderPlugin({ groups: [''] }).getProviders()).toThrow(InvalidLeaderConfigError);
    });

    it('should validate options produced by registerAsync factories too', async () => {
      // Given
      const plugin = LeaderPlugin.registerAsync({ useFactory: () => ({ ttlMs: -1 }) });
      const optionsProvider = findProvider(plugin.getProviders(), LEADER_PLUGIN_OPTIONS);

      // When/Then
      await expect(optionsProvider.useFactory()).rejects.toThrow(InvalidLeaderConfigError);
    });
  });

  describe('registerAsync', () => {
    it('should merge defaults over factory results', async () => {
      // Given
      const plugin = LeaderPlugin.registerAsync({ useFactory: () => ({ ttlMs: 30_000 }), inject: [] });

      // When
      const optionsProvider = findProvider(plugin.getProviders(), LEADER_PLUGIN_OPTIONS);
      const config = await optionsProvider.useFactory();

      // Then
      expect(config.ttlMs).toBe(30_000);
      expect(config.keyPrefix).toBe('leader:');
    });

    it('should pass through imports', () => {
      // Given
      class ConfigModule {}
      const plugin = LeaderPlugin.registerAsync({ imports: [ConfigModule], useFactory: () => ({}) } as never);

      // Then
      expect(plugin.getImports!()).toEqual([ConfigModule]);
    });
  });
});
