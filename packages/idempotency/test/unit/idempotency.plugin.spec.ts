import { describe, it, expect } from 'vitest';
import { IdempotencyPlugin } from '../../src/idempotency.plugin';
import { IDEMPOTENCY_PLUGIN_OPTIONS, IDEMPOTENCY_SERVICE, IDEMPOTENCY_STORE } from '../../src/shared/constants';

describe('IdempotencyPlugin', () => {
  it('should have correct metadata', () => {
    // Given/When
    const plugin = new IdempotencyPlugin();

    // Then
    expect(plugin.name).toBe('idempotency');
    expect(plugin.version).toBe('0.1.0');
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
    // Options, Store, Service, Reflector, IdempotencyInterceptor
    expect(providers).toHaveLength(5);
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
});
