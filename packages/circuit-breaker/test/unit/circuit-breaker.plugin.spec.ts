import { describe, it, expect } from 'vitest';
import { CircuitBreakerPlugin } from '../../src/circuit-breaker.plugin';
import { version } from '../../package.json';
import { CIRCUIT_BREAKER_PLUGIN_OPTIONS, CIRCUIT_BREAKER_SERVICE } from '../../src/circuit-breaker/shared/constants';
import type { ICircuitBreakerPluginOptions } from '../../src/circuit-breaker/shared/types';

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
        errorPolicy: 'fail-closed',
      });
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
