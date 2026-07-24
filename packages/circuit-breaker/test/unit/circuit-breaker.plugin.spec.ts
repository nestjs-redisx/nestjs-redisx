import { describe, it, expect } from 'vitest';
import { CircuitBreakerPlugin } from '../../src/circuit-breaker.plugin';
import { version } from '../../package.json';
import { CIRCUIT_BREAKER_PLUGIN_OPTIONS, CIRCUIT_BREAKER_REDIS_DRIVER, CIRCUIT_BREAKER_SERVICE } from '../../src/shared/constants';
import { InvalidCircuitBreakerConfigError } from '../../src/shared/errors';
import type { ICircuitBreakerPluginOptions } from '../../src/shared/types';

function optionsProviderValue(plugin: CircuitBreakerPlugin): Record<string, unknown> {
  const providers = plugin.getProviders();
  const provider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === CIRCUIT_BREAKER_PLUGIN_OPTIONS);
  return (provider as { useValue: Record<string, unknown> }).useValue;
}

describe('CircuitBreakerPlugin', () => {
  describe('plugin metadata', () => {
    it('should expose name, version and description', () => {
      // Given / When
      const plugin = new CircuitBreakerPlugin();

      // Then
      expect(plugin.name).toBe('circuit-breaker');
      expect(plugin.version).toBe(version);
      expect(plugin.description).toContain('circuit breaker');
    });
  });

  describe('default configuration', () => {
    it('should apply defaults when no options are provided', () => {
      // Given / When
      const value = optionsProviderValue(new CircuitBreakerPlugin());

      // Then
      expect(value).toMatchObject({
        keyPrefix: 'cb:',
        failureThreshold: 5,
        windowMs: 10000,
        openDurationMs: 30000,
        halfOpenMaxCalls: 1,
        successThreshold: 1,
        probeTimeoutMs: 30000, // dynamic default = openDurationMs
        errorPolicy: 'fail-closed',
      });
    });

    it('should default probeTimeoutMs to the RESOLVED openDurationMs', () => {
      // Given — custom cooldown, no explicit probe timeout
      const value = optionsProviderValue(new CircuitBreakerPlugin({ openDurationMs: 5000 }));

      // Then — probe timeout follows the cooldown
      expect(value).toMatchObject({ openDurationMs: 5000, probeTimeoutMs: 5000 });
    });

    it('should honor an explicit probeTimeoutMs over the dynamic default', () => {
      // Given
      const value = optionsProviderValue(new CircuitBreakerPlugin({ openDurationMs: 5000, probeTimeoutMs: 2000 }));

      // Then
      expect(value).toMatchObject({ openDurationMs: 5000, probeTimeoutMs: 2000 });
    });

    it('should override defaults from user options', () => {
      // Given
      const options: ICircuitBreakerPluginOptions = {
        failureThreshold: 10,
        openDurationMs: 60000,
        errorPolicy: 'fail-open',
      };

      // When
      const value = optionsProviderValue(new CircuitBreakerPlugin(options));

      // Then
      expect(value).toMatchObject({ failureThreshold: 10, openDurationMs: 60000, errorPolicy: 'fail-open', windowMs: 10000 });
    });
  });

  describe('providers & exports', () => {
    it('should register the options, redis-driver, store, service, initializer and reflector providers', () => {
      // Given / When
      const providers = new CircuitBreakerPlugin().getProviders();

      // Then
      const tokens = providers.map((p) => (typeof p === 'object' && 'provide' in p ? p.provide : p));
      expect(tokens).toContain(CIRCUIT_BREAKER_PLUGIN_OPTIONS);
      expect(tokens).toContain(CIRCUIT_BREAKER_SERVICE);
      // 6 providers: options, redis-driver, store, service, decorator-initializer, Reflector
      expect(providers).toHaveLength(6);
    });

    it('should export the service token', () => {
      // Given / When
      const exports = new CircuitBreakerPlugin().getExports();

      // Then
      expect(exports).toContain(CIRCUIT_BREAKER_SERVICE);
    });
  });

  describe('redis driver provider (named client resolution)', () => {
    type DriverFactory = (manager: unknown, init: void, options: ICircuitBreakerPluginOptions) => Promise<unknown>;

    function driverFactory(plugin: CircuitBreakerPlugin): DriverFactory {
      const provider = plugin.getProviders().find((p) => typeof p === 'object' && 'provide' in p && p.provide === CIRCUIT_BREAKER_REDIS_DRIVER) as { useFactory: DriverFactory };
      return provider.useFactory;
    }

    it('should resolve the default client when no client option is set', async () => {
      // Given
      const client = { id: 'redis' };
      const manager = { getClient: async (name: string) => (name === 'default' ? client : Promise.reject(new Error('missing'))) };

      // When
      const resolved = await driverFactory(new CircuitBreakerPlugin())(manager, undefined, {});

      // Then
      expect(resolved).toBe(client);
    });

    it('should resolve a named client from plugin options', async () => {
      // Given
      const client = { id: 'breaker-redis' };
      const manager = { getClient: async (name: string) => (name === 'breaker' ? client : Promise.reject(new Error('missing'))) };

      // When
      const resolved = await driverFactory(new CircuitBreakerPlugin())(manager, undefined, { client: 'breaker' });

      // Then
      expect(resolved).toBe(client);
    });

    it('should throw a descriptive error when the named client does not exist', async () => {
      // Given
      const manager = {
        getClient: async () => {
          throw new Error('no such client');
        },
      };

      // When / Then
      await expect(driverFactory(new CircuitBreakerPlugin())(manager, undefined, { client: 'ghost' })).rejects.toThrow('CircuitBreakerPlugin: Redis client "ghost" not found');
    });
  });

  describe('configuration validation (fail-fast at bootstrap)', () => {
    it.each([
      ['failureThreshold: 0', { failureThreshold: 0 }],
      ['windowMs: 0', { windowMs: 0 }],
      ['openDurationMs: -1', { openDurationMs: -1 }],
      ['halfOpenMaxCalls: 0', { halfOpenMaxCalls: 0 }],
      ['successThreshold: 1.5', { successThreshold: 1.5 }],
      ['probeTimeoutMs: 0', { probeTimeoutMs: 0 }],
    ])('should throw InvalidCircuitBreakerConfigError for %s', (_label, options) => {
      // Given
      const plugin = new CircuitBreakerPlugin(options as ICircuitBreakerPluginOptions);

      // When / Then — sync path validates when providers are built
      expect(() => plugin.getProviders()).toThrow(InvalidCircuitBreakerConfigError);
    });

    it('should reject successThreshold greater than halfOpenMaxCalls', () => {
      // Given
      const plugin = new CircuitBreakerPlugin({ halfOpenMaxCalls: 1, successThreshold: 2 });

      // When / Then
      expect(() => plugin.getProviders()).toThrow(InvalidCircuitBreakerConfigError);
    });

    it('should reject an invalid config coming from the async factory', async () => {
      // Given
      const plugin = CircuitBreakerPlugin.registerAsync({
        inject: [],
        useFactory: () => ({ windowMs: 0 }),
      });
      const providers = plugin.getProviders();
      const optionsProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === CIRCUIT_BREAKER_PLUGIN_OPTIONS) as { useFactory: (...args: unknown[]) => Promise<unknown> };

      // When / Then — async path validates when the factory resolves
      await expect(optionsProvider.useFactory()).rejects.toBeInstanceOf(InvalidCircuitBreakerConfigError);
    });
  });

  describe('registerAsync', () => {
    it('should build an async options provider (useFactory) and pass imports', () => {
      // Given
      const plugin = CircuitBreakerPlugin.registerAsync({
        imports: [],
        inject: [],
        useFactory: () => ({ failureThreshold: 3 }),
      });

      // When
      const providers = plugin.getProviders();
      const optionsProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === CIRCUIT_BREAKER_PLUGIN_OPTIONS);

      // Then
      expect(optionsProvider).toBeDefined();
      expect((optionsProvider as { useFactory?: unknown }).useFactory).toBeTypeOf('function');
      expect(plugin.getImports()).toEqual([]);
    });

    it('should merge defaults over the async factory result', async () => {
      // Given
      const plugin = CircuitBreakerPlugin.registerAsync({
        inject: [],
        useFactory: () => ({ failureThreshold: 3 }),
      });
      const providers = plugin.getProviders();
      const optionsProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === CIRCUIT_BREAKER_PLUGIN_OPTIONS) as { useFactory: (...args: unknown[]) => Promise<Record<string, unknown>> };

      // When
      const resolved = await optionsProvider.useFactory();

      // Then
      expect(resolved).toMatchObject({ failureThreshold: 3, windowMs: 10000, errorPolicy: 'fail-closed' });
    });
  });
});
