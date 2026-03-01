import { describe, it, expect } from 'vitest';
import { IdempotencyPlugin } from '../../src/idempotency.plugin';
import { version } from '../../package.json';
import { IDEMPOTENCY_PLUGIN_OPTIONS, IDEMPOTENCY_SERVICE, IDEMPOTENCY_STORE, IDEMPOTENCY_REDIS_DRIVER } from '../../src/shared/constants';
import { CLIENT_MANAGER, REDIS_CLIENTS_INITIALIZATION } from '@nestjs-redisx/core';

describe('IdempotencyPlugin', () => {
  it('should have correct metadata', () => {
    // Given/When
    const plugin = new IdempotencyPlugin();

    // Then
    expect(plugin.name).toBe('idempotency');
    expect(plugin.version).toBe(version);
    expect(plugin.description).toContain('deduplication');
  });

  it('should use default configuration', () => {
    // Given
    const plugin = new IdempotencyPlugin();

    // When
    const providers = plugin.getProviders();
    const config = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === IDEMPOTENCY_PLUGIN_OPTIONS);

    // Then
    expect((config as any).useValue).toMatchObject({
      defaultTtl: 86400,
      keyPrefix: 'idempotency:',
      headerName: 'Idempotency-Key',
    });
  });

  it('should merge custom options', () => {
    // Given
    const plugin = new IdempotencyPlugin({ defaultTtl: 3600, keyPrefix: 'custom:' });

    // When
    const providers = plugin.getProviders();
    const config = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === IDEMPOTENCY_PLUGIN_OPTIONS);

    // Then
    expect((config as any).useValue.defaultTtl).toBe(3600);
    expect((config as any).useValue.keyPrefix).toBe('custom:');
  });

  it('should provide all required providers', () => {
    // Given
    const plugin = new IdempotencyPlugin();

    // When
    const providers = plugin.getProviders();

    // Then
    // Options, Driver, Store, Service, Reflector, IdempotencyInterceptor
    expect(providers).toHaveLength(6);
  });

  it('should export service and interceptor', () => {
    // Given
    const plugin = new IdempotencyPlugin();

    // When
    const exports = plugin.getExports();

    // Then
    expect(exports).toContain(IDEMPOTENCY_PLUGIN_OPTIONS);
    expect(exports).toContain(IDEMPOTENCY_SERVICE);
    expect(exports).toHaveLength(3);
  });

  describe('per-plugin client selection', () => {
    it('should include IDEMPOTENCY_REDIS_DRIVER provider in getProviders()', () => {
      // Given
      const plugin = new IdempotencyPlugin();

      // When
      const providers = plugin.getProviders();
      const driverProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === IDEMPOTENCY_REDIS_DRIVER);

      // Then
      expect(driverProvider).toBeDefined();
      expect(driverProvider).toHaveProperty('useFactory');
      expect((driverProvider as any).inject).toContain(CLIENT_MANAGER);
      expect((driverProvider as any).inject).toContain(REDIS_CLIENTS_INITIALIZATION);
      expect((driverProvider as any).inject).toContain(IDEMPOTENCY_PLUGIN_OPTIONS);
    });

    it('should use default client name when client option not specified', () => {
      // Given
      const plugin = new IdempotencyPlugin();

      // When
      const providers = plugin.getProviders();
      const configProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === IDEMPOTENCY_PLUGIN_OPTIONS);

      // Then
      expect((configProvider as any).useValue.client).toBeUndefined();
    });

    it('should pass custom client name through options', () => {
      // Given
      const plugin = new IdempotencyPlugin({ client: 'idempotency-dedicated' });

      // When
      const providers = plugin.getProviders();
      const configProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === IDEMPOTENCY_PLUGIN_OPTIONS);

      // Then
      expect((configProvider as any).useValue.client).toBe('idempotency-dedicated');
    });

    it('should work with registerAsync and preserve client option', async () => {
      // Given
      const plugin = IdempotencyPlugin.registerAsync({
        useFactory: () => ({ client: 'async-idempotency' }),
      });

      // When
      const providers = plugin.getProviders();
      const configProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === IDEMPOTENCY_PLUGIN_OPTIONS);
      const config = await (configProvider as any).useFactory();

      // Then
      expect(config.client).toBe('async-idempotency');
    });

    it('should throw descriptive error when client name is invalid', async () => {
      // Given
      const plugin = new IdempotencyPlugin({ client: 'nonexistent' });
      const providers = plugin.getProviders();
      const driverProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === IDEMPOTENCY_REDIS_DRIVER);
      const factory = (driverProvider as any).useFactory;
      const mockManager = {
        getClient: () => {
          throw new Error('Client not found');
        },
      };

      // When/Then
      await expect(factory(mockManager, undefined, { client: 'nonexistent' })).rejects.toThrow('IdempotencyPlugin: Redis client "nonexistent" not found');
    });
  });
});
