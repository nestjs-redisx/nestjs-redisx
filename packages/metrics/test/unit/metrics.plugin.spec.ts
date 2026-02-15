import { describe, it, expect } from 'vitest';
import { MetricsPlugin } from '../../src/metrics.plugin';
import { METRICS_PLUGIN_OPTIONS, METRICS_SERVICE } from '../../src/shared/constants';
import { MetricsController } from '../../src/metrics/api/controllers/metrics.controller';

describe('MetricsPlugin', () => {
  it('should have correct metadata', () => {
    // Given/When
    const plugin = new MetricsPlugin();

    // Then
    expect(plugin.name).toBe('metrics');
    expect(plugin.version).toBe('0.1.0');
    expect(plugin.description).toContain('Prometheus');
  });

  it('should use default configuration', () => {
    // Given
    const plugin = new MetricsPlugin();

    // When
    const providers = plugin.getProviders();
    const config = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === METRICS_PLUGIN_OPTIONS);

    // Then
    expect((config as any).useValue).toMatchObject({
      enabled: true,
      prefix: 'redisx_',
      exposeEndpoint: true,
      endpoint: '/metrics',
      collectDefaultMetrics: true,
      commandMetrics: true,
      pluginMetrics: true,
      collectInterval: 15000,
    });
  });

  it('should merge custom options', () => {
    // Given
    const plugin = new MetricsPlugin({
      enabled: false,
      prefix: 'custom_',
      endpoint: '/custom-metrics',
    });

    // When
    const providers = plugin.getProviders();
    const config = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === METRICS_PLUGIN_OPTIONS);

    // Then
    expect((config as any).useValue).toMatchObject({
      enabled: false,
      prefix: 'custom_',
      endpoint: '/custom-metrics',
    });
  });

  it('should include controller when exposeEndpoint is true', () => {
    // Given
    const plugin = new MetricsPlugin({ exposeEndpoint: true });

    // When
    const controllers = plugin.getControllers?.();

    // Then
    expect(controllers).toBeDefined();
    expect(controllers).toContain(MetricsController);
  });

  it('should not include controller when exposeEndpoint is false', () => {
    // Given
    const plugin = new MetricsPlugin({ exposeEndpoint: false });

    // When
    const controllers = plugin.getControllers?.();

    // Then
    expect(controllers).toBeDefined();
    expect(controllers).not.toContain(MetricsController);
    expect(controllers).toHaveLength(0);
  });

  it('should provide metrics service', () => {
    // Given
    const plugin = new MetricsPlugin();

    // When
    const providers = plugin.getProviders();

    // Then
    const serviceProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === METRICS_SERVICE);
    expect(serviceProvider).toBeDefined();
  });

  it('should export metrics service', () => {
    // Given
    const plugin = new MetricsPlugin();

    // When
    const exports = plugin.getExports();

    // Then
    expect(exports).toContain(METRICS_SERVICE);
    expect(exports).toHaveLength(1);
  });

  it('should use custom histogram buckets', () => {
    // Given
    const customBuckets = [0.1, 0.5, 1, 5, 10];
    const plugin = new MetricsPlugin({ histogramBuckets: customBuckets });

    // When
    const providers = plugin.getProviders();
    const config = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === METRICS_PLUGIN_OPTIONS);

    // Then
    expect((config as any).useValue.histogramBuckets).toEqual(customBuckets);
  });

  it('should include default labels when provided', () => {
    // Given
    const defaultLabels = { env: 'production', region: 'us-east-1' };
    const plugin = new MetricsPlugin({ defaultLabels });

    // When
    const providers = plugin.getProviders();
    const config = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === METRICS_PLUGIN_OPTIONS);

    // Then
    expect((config as any).useValue.defaultLabels).toEqual(defaultLabels);
  });

  it('should disable default metrics collection', () => {
    // Given
    const plugin = new MetricsPlugin({ collectDefaultMetrics: false });

    // When
    const providers = plugin.getProviders();
    const config = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === METRICS_PLUGIN_OPTIONS);

    // Then
    expect((config as any).useValue.collectDefaultMetrics).toBe(false);
  });

  it('should propagate commandMetrics option', () => {
    // Given
    const plugin = new MetricsPlugin({ commandMetrics: false });

    // When
    const providers = plugin.getProviders();
    const config = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === METRICS_PLUGIN_OPTIONS);

    // Then
    expect((config as any).useValue.commandMetrics).toBe(false);
  });

  it('should propagate pluginMetrics option', () => {
    // Given
    const plugin = new MetricsPlugin({ pluginMetrics: false });

    // When
    const providers = plugin.getProviders();
    const config = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === METRICS_PLUGIN_OPTIONS);

    // Then
    expect((config as any).useValue.pluginMetrics).toBe(false);
  });

  it('should propagate collectInterval option', () => {
    // Given
    const plugin = new MetricsPlugin({ collectInterval: 30000 });

    // When
    const providers = plugin.getProviders();
    const config = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === METRICS_PLUGIN_OPTIONS);

    // Then
    expect((config as any).useValue.collectInterval).toBe(30000);
  });
});
