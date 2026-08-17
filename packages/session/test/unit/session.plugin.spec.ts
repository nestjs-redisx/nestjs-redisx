import { describe, it, expect, vi } from 'vitest';
import type { FactoryProvider, ValueProvider } from '@nestjs/common';

import { SessionPlugin } from '../../src/session.plugin';
import { SESSION_PLUGIN_OPTIONS, SESSION_REDIS_DRIVER, SESSION_SERVICE, SESSION_STORE } from '../../src/shared/constants';
import { InvalidSessionConfigError } from '../../src/shared/errors';
import type { ISessionPluginOptions } from '../../src/shared/types';

function findProvider(plugin: SessionPlugin, token: symbol): FactoryProvider | ValueProvider | undefined {
  return plugin.getProviders().find((p) => typeof p === 'object' && 'provide' in p && p.provide === token) as FactoryProvider | ValueProvider | undefined;
}

function optionsOf(plugin: SessionPlugin): ISessionPluginOptions {
  const provider = findProvider(plugin, SESSION_PLUGIN_OPTIONS) as ValueProvider;
  return provider.useValue as ISessionPluginOptions;
}

describe('SessionPlugin', () => {
  describe('identity', () => {
    it('should expose name, version, and description', () => {
      // When
      const plugin = new SessionPlugin();

      // Then
      expect(plugin.name).toBe('session');
      expect(plugin.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(plugin.description).toBeTruthy();
    });
  });

  describe('option merging', () => {
    it('should apply defaults for omitted options', () => {
      // When
      const options = optionsOf(new SessionPlugin());

      // Then
      expect(options.keyPrefix).toBe('sess:');
      expect(options.defaultTtlMs).toBe(86_400_000);
      expect(options.maxSessionsPolicy).toBe('evict-oldest');
      expect(typeof options.userIdExtractor).toBe('function');
      expect(options.absoluteLifetimeMs).toBeUndefined();
      expect(options.maxSessionsPerUser).toBeUndefined();
    });

    it('should keep user-provided options', () => {
      // Given
      const extractor = (): string => 'fixed';

      // When
      const options = optionsOf(
        new SessionPlugin({
          client: 'sessions',
          keyPrefix: 'app-sess:',
          defaultTtlMs: 1000,
          absoluteLifetimeMs: 5000,
          maxSessionsPerUser: 3,
          maxSessionsPolicy: 'reject',
          userIdExtractor: extractor,
        }),
      );

      // Then
      expect(options.client).toBe('sessions');
      expect(options.keyPrefix).toBe('app-sess:');
      expect(options.defaultTtlMs).toBe(1000);
      expect(options.absoluteLifetimeMs).toBe(5000);
      expect(options.maxSessionsPerUser).toBe(3);
      expect(options.maxSessionsPolicy).toBe('reject');
      expect(options.userIdExtractor).toBe(extractor);
    });

    it('should fail fast on invalid options', () => {
      // When / Then
      expect(() => new SessionPlugin({ defaultTtlMs: -1 }).getProviders()).toThrow(InvalidSessionConfigError);
      expect(() => new SessionPlugin({ maxSessionsPerUser: 0 }).getProviders()).toThrow(InvalidSessionConfigError);
    });
  });

  describe('providers', () => {
    it('should provide options, driver, store, and service', () => {
      // Given
      const plugin = new SessionPlugin();

      // When
      const tokens = plugin.getProviders().map((p) => (typeof p === 'object' && 'provide' in p ? p.provide : p));

      // Then
      expect(tokens).toEqual(expect.arrayContaining([SESSION_PLUGIN_OPTIONS, SESSION_REDIS_DRIVER, SESSION_STORE, SESSION_SERVICE]));
    });

    it('should resolve the named Redis client through the client manager', async () => {
      // Given
      const plugin = new SessionPlugin({ client: 'sessions' });
      const driverProvider = findProvider(plugin, SESSION_REDIS_DRIVER) as FactoryProvider;
      const fakeDriver = { id: 'driver' };
      const manager = { getClient: vi.fn().mockResolvedValue(fakeDriver) };

      // When
      const resolved = await (driverProvider.useFactory as (...args: unknown[]) => Promise<unknown>)(manager, undefined, optionsOf(plugin));

      // Then
      expect(manager.getClient).toHaveBeenCalledWith('sessions');
      expect(resolved).toBe(fakeDriver);
    });

    it('should explain how to fix a missing named client', async () => {
      // Given
      const plugin = new SessionPlugin({ client: 'missing' });
      const driverProvider = findProvider(plugin, SESSION_REDIS_DRIVER) as FactoryProvider;
      const manager = { getClient: vi.fn().mockRejectedValue(new Error('not found')) };

      // When / Then
      await expect((driverProvider.useFactory as (...args: unknown[]) => Promise<unknown>)(manager, undefined, optionsOf(plugin))).rejects.toThrow(/missing/);
    });
  });

  describe('registerAsync', () => {
    it('should merge and validate options produced by the factory', async () => {
      // Given
      const plugin = SessionPlugin.registerAsync({
        useFactory: () => ({ defaultTtlMs: 1234 }),
      });
      const optionsProvider = findProvider(plugin, SESSION_PLUGIN_OPTIONS) as FactoryProvider;

      // When
      const options = (await (optionsProvider.useFactory as (...args: unknown[]) => Promise<ISessionPluginOptions>)()) as ISessionPluginOptions;

      // Then
      expect(options.defaultTtlMs).toBe(1234);
      expect(options.keyPrefix).toBe('sess:');
    });

    it('should fail fast when the factory produces invalid options', async () => {
      // Given
      const plugin = SessionPlugin.registerAsync({
        useFactory: () => ({ defaultTtlMs: 0 }),
      });
      const optionsProvider = findProvider(plugin, SESSION_PLUGIN_OPTIONS) as FactoryProvider;

      // When / Then
      await expect((optionsProvider.useFactory as (...args: unknown[]) => Promise<ISessionPluginOptions>)()).rejects.toThrow(InvalidSessionConfigError);
    });

    it('should surface async imports through getImports', () => {
      // Given
      class FakeModule {}
      const plugin = SessionPlugin.registerAsync({ imports: [FakeModule], useFactory: () => ({}) });

      // When / Then
      expect(plugin.getImports()).toEqual([FakeModule]);
      expect(new SessionPlugin().getImports()).toEqual([]);
    });
  });

  describe('exports', () => {
    it('should export the service and the store', () => {
      // When
      const exports = new SessionPlugin().getExports();

      // Then
      expect(exports).toContain(SESSION_SERVICE);
      expect(exports).toContain(SESSION_STORE);
    });
  });
});
