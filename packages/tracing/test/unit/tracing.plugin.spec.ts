import { describe, it, expect } from 'vitest';
import { TracingPlugin } from '../../src/tracing.plugin';
import { version } from '../../package.json';
import { TRACING_PLUGIN_OPTIONS, TRACING_SERVICE } from '../../src/shared/constants';

describe('TracingPlugin', () => {
  it('should have correct metadata', () => {
    // Given/When
    const plugin = new TracingPlugin();

    // Then
    expect(plugin.name).toBe('tracing');
    expect(plugin.version).toBe(version);
    expect(plugin.description).toContain('OpenTelemetry');
  });

  it('should use default configuration', () => {
    // Given
    const plugin = new TracingPlugin();

    // When
    const providers = plugin.getProviders();
    const config = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === TRACING_PLUGIN_OPTIONS);

    // Then
    expect((config as any).useValue).toMatchObject({
      enabled: true,
      serviceName: 'nestjs-redisx',
      sampleRate: 1.0,
      traceRedisCommands: true,
      traceHttpRequests: true,
      sampling: { strategy: 'always', ratio: 1.0 },
      spans: { includeArgs: false, includeResult: false, maxArgLength: 100, excludeCommands: [] },
      pluginTracing: true,
    });
  });

  it('should merge custom options', () => {
    // Given
    const plugin = new TracingPlugin({
      enabled: false,
      serviceName: 'my-service',
      sampleRate: 0.5,
    });

    // When
    const providers = plugin.getProviders();
    const config = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === TRACING_PLUGIN_OPTIONS);

    // Then
    expect((config as any).useValue).toMatchObject({
      enabled: false,
      serviceName: 'my-service',
      sampleRate: 0.5,
    });
  });

  it('should configure with exporter', () => {
    // Given
    const exporter = {
      type: 'otlp' as const,
      endpoint: 'http://localhost:4318/v1/traces',
    };
    const plugin = new TracingPlugin({ exporter });

    // When
    const providers = plugin.getProviders();
    const config = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === TRACING_PLUGIN_OPTIONS);

    // Then
    expect((config as any).useValue.exporter).toEqual(exporter);
  });

  it('should configure with resource attributes', () => {
    // Given
    const resourceAttributes = {
      'service.version': '1.0.0',
      'deployment.environment': 'production',
    };
    const plugin = new TracingPlugin({ resourceAttributes });

    // When
    const providers = plugin.getProviders();
    const config = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === TRACING_PLUGIN_OPTIONS);

    // Then
    expect((config as any).useValue.resourceAttributes).toEqual(resourceAttributes);
  });

  it('should disable Redis command tracing', () => {
    // Given
    const plugin = new TracingPlugin({ traceRedisCommands: false });

    // When
    const providers = plugin.getProviders();
    const config = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === TRACING_PLUGIN_OPTIONS);

    // Then
    expect((config as any).useValue.traceRedisCommands).toBe(false);
  });

  it('should disable HTTP request tracing', () => {
    // Given
    const plugin = new TracingPlugin({ traceHttpRequests: false });

    // When
    const providers = plugin.getProviders();
    const config = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === TRACING_PLUGIN_OPTIONS);

    // Then
    expect((config as any).useValue.traceHttpRequests).toBe(false);
  });

  it('should provide tracing service', () => {
    // Given
    const plugin = new TracingPlugin();

    // When
    const providers = plugin.getProviders();

    // Then
    expect(providers).toHaveLength(2);
    const serviceProvider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === TRACING_SERVICE);
    expect(serviceProvider).toBeDefined();
  });

  it('should export tracing service', () => {
    // Given
    const plugin = new TracingPlugin();

    // When
    const exports = plugin.getExports();

    // Then
    expect(exports).toContain(TRACING_SERVICE);
    expect(exports).toHaveLength(1);
  });

  it('should propagate sampling options', () => {
    // Given
    const plugin = new TracingPlugin({
      sampling: { strategy: 'ratio', ratio: 0.5 },
    });

    // When
    const providers = plugin.getProviders();
    const config = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === TRACING_PLUGIN_OPTIONS);

    // Then
    expect((config as any).useValue.sampling).toEqual({ strategy: 'ratio', ratio: 0.5 });
  });

  it('should propagate spans options', () => {
    // Given
    const plugin = new TracingPlugin({
      spans: { includeArgs: true, includeResult: true, maxArgLength: 200, excludeCommands: ['PING'] },
    });

    // When
    const providers = plugin.getProviders();
    const config = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === TRACING_PLUGIN_OPTIONS);

    // Then
    expect((config as any).useValue.spans).toEqual({
      includeArgs: true,
      includeResult: true,
      maxArgLength: 200,
      excludeCommands: ['PING'],
    });
  });

  it('should propagate pluginTracing option', () => {
    // Given
    const plugin = new TracingPlugin({ pluginTracing: false });

    // When
    const providers = plugin.getProviders();
    const config = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === TRACING_PLUGIN_OPTIONS);

    // Then
    expect((config as any).useValue.pluginTracing).toBe(false);
  });

  it('should configure all options together', () => {
    // Given
    const plugin = new TracingPlugin({
      enabled: true,
      serviceName: 'custom-service',
      sampleRate: 0.7,
      traceRedisCommands: false,
      traceHttpRequests: true,
      exporter: { type: 'jaeger' as const, endpoint: 'http://jaeger:14268/api/traces' },
      resourceAttributes: { app: 'test' },
      sampling: { strategy: 'parent', ratio: 0.8 },
      spans: { includeArgs: true, maxArgLength: 50 },
      pluginTracing: false,
    });

    // When
    const providers = plugin.getProviders();
    const config = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === TRACING_PLUGIN_OPTIONS);

    // Then
    expect((config as any).useValue).toMatchObject({
      enabled: true,
      serviceName: 'custom-service',
      sampleRate: 0.7,
      traceRedisCommands: false,
      traceHttpRequests: true,
      sampling: { strategy: 'parent', ratio: 0.8 },
      spans: { includeArgs: true, includeResult: false, maxArgLength: 50, excludeCommands: [] },
      pluginTracing: false,
    });
  });
});
