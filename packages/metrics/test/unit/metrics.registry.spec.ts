import { describe, it, expect, afterEach, vi } from 'vitest';
import * as promClient from 'prom-client';
import { MetricsService } from '../../src/metrics/application/services/metrics.service';
import { MetricsPlugin } from '../../src/metrics.plugin';
import { METRICS_PLUGIN_OPTIONS } from '../../src/shared/constants';
import type { IMetricsPluginOptions } from '../../src/shared/types';

/**
 * Registry selection: 'own' (default, isolated) | 'default' (global
 * promClient.register) | a user-provided Registry instance.
 */
describe('MetricsService registry option', () => {
  let service: MetricsService | undefined;

  afterEach(() => {
    service?.onModuleDestroy();
    service = undefined;
    promClient.register.clear();
  });

  function build(config: IMetricsPluginOptions = {}): MetricsService {
    service = new MetricsService({ commandMetrics: false, pluginMetrics: false, collectDefaultMetrics: false, ...config });
    return service;
  }

  describe("'own' registry (default)", () => {
    it('should keep metrics OUT of the global prom-client registry', async () => {
      // Given
      const svc = build();
      svc.onModuleInit();

      // When
      svc.registerCounter('redisx_own_test_total', 'own test counter');
      svc.incrementCounter('redisx_own_test_total');

      // Then — visible in the service output, absent from the global registry
      await expect(svc.getMetrics()).resolves.toContain('redisx_own_test_total');
      expect(promClient.register.getSingleMetric('redisx_own_test_total')).toBeUndefined();
    });

    it('should clear the whole own registry on destroy', async () => {
      // Given
      const svc = build();
      svc.onModuleInit();
      svc.registerCounter('redisx_own_clear_total', 'counter');

      // When
      svc.onModuleDestroy();

      // Then
      await expect(svc.getMetrics()).resolves.not.toContain('redisx_own_clear_total');
    });
  });

  describe("'default' registry (global promClient.register)", () => {
    it('should register metrics into the global registry', async () => {
      // Given
      const svc = build({ registry: 'default' });
      svc.onModuleInit();

      // When
      svc.registerCounter('redisx_global_test_total', 'global test counter');
      svc.incrementCounter('redisx_global_test_total', undefined, 3);

      // Then — the app's own /metrics endpoint (global registry) sees it
      expect(promClient.register.getSingleMetric('redisx_global_test_total')).toBeDefined();
      await expect(promClient.register.metrics()).resolves.toContain('redisx_global_test_total 3');
    });

    it('should remove ONLY its own metrics on destroy, leaving app metrics intact', async () => {
      // Given — an application metric lives in the global registry
      const appCounter = new promClient.Counter({ name: 'app_requests_total', help: 'app metric', registers: [promClient.register] });
      appCounter.inc();
      const svc = build({ registry: 'default' });
      svc.onModuleInit();
      svc.registerCounter('redisx_destroy_test_total', 'plugin metric');

      // When
      svc.onModuleDestroy();

      // Then
      expect(promClient.register.getSingleMetric('redisx_destroy_test_total')).toBeUndefined();
      expect(promClient.register.getSingleMetric('app_requests_total')).toBeDefined();
    });

    it('should NOT touch default labels of an external registry unless explicitly configured', () => {
      // Given
      const setLabelsSpy = vi.spyOn(promClient.register, 'setDefaultLabels');

      // When — no defaultLabels configured
      build({ registry: 'default' });

      // Then
      expect(setLabelsSpy).not.toHaveBeenCalled();
      setLabelsSpy.mockRestore();
    });

    it('should apply default labels to an external registry when explicitly configured', () => {
      // Given
      const setLabelsSpy = vi.spyOn(promClient.register, 'setDefaultLabels');

      // When
      build({ registry: 'default', defaultLabels: { app: 'shop' } });

      // Then
      expect(setLabelsSpy).toHaveBeenCalledWith({ app: 'shop' });
      setLabelsSpy.mockRestore();
    });

    it('should NOT collect default Node.js metrics on an external registry unless opted in', () => {
      // Given / When — collectDefaultMetrics left at its default
      service = new MetricsService({ registry: 'default', commandMetrics: false, pluginMetrics: false });
      service.onModuleInit();

      // Then — the app almost certainly collects process metrics already
      expect(promClient.register.getSingleMetric('redisx_process_cpu_user_seconds_total')).toBeUndefined();
    });

    it('should collect default Node.js metrics on an external registry with explicit opt-in', () => {
      // Given / When
      service = new MetricsService({ registry: 'default', commandMetrics: false, pluginMetrics: false, collectDefaultMetrics: true });
      service.onModuleInit();

      // Then
      expect(promClient.register.getSingleMetric('redisx_process_cpu_user_seconds_total')).toBeDefined();
    });
  });

  describe('user-provided Registry instance', () => {
    it('should register metrics into the provided registry', async () => {
      // Given
      const custom = new promClient.Registry();
      const svc = build({ registry: custom });
      svc.onModuleInit();

      // When
      svc.registerCounter('redisx_custom_reg_total', 'custom registry counter');
      svc.incrementCounter('redisx_custom_reg_total');

      // Then
      expect(custom.getSingleMetric('redisx_custom_reg_total')).toBeDefined();
      expect(promClient.register.getSingleMetric('redisx_custom_reg_total')).toBeUndefined();
      await expect(svc.getMetrics()).resolves.toContain('redisx_custom_reg_total');
    });

    it('should treat a provided registry as external on destroy', () => {
      // Given
      const custom = new promClient.Registry();
      const appGauge = new promClient.Gauge({ name: 'app_gauge', help: 'app metric', registers: [custom] });
      appGauge.set(1);
      const svc = build({ registry: custom });
      svc.onModuleInit();
      svc.registerGauge('redisx_custom_destroy_gauge', 'plugin gauge');

      // When
      svc.onModuleDestroy();

      // Then
      expect(custom.getSingleMetric('redisx_custom_destroy_gauge')).toBeUndefined();
      expect(custom.getSingleMetric('app_gauge')).toBeDefined();
    });
  });

  describe('collectDefaultMetrics with the own registry (regression)', () => {
    it('should still collect default metrics by default on the own registry', async () => {
      // Given / When
      service = new MetricsService({ commandMetrics: false, pluginMetrics: false });
      service.onModuleInit();

      // Then
      await expect(service.getMetrics()).resolves.toContain('redisx_process_cpu_user_seconds_total');
      expect(promClient.register.getSingleMetric('redisx_process_cpu_user_seconds_total')).toBeUndefined();
    });
  });
});

describe('MetricsPlugin registry defaults', () => {
  function resolvedOptions(plugin: MetricsPlugin): Record<string, unknown> {
    const providers = plugin.getProviders();
    const config = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === METRICS_PLUGIN_OPTIONS);
    return (config as any).useValue;
  }

  it("should default registry to 'own' and keep collectDefaultMetrics enabled", () => {
    // Given/When
    const options = resolvedOptions(new MetricsPlugin());

    // Then
    expect(options.registry).toBe('own');
    expect(options.collectDefaultMetrics).toBe(true);
  });

  it('should default collectDefaultMetrics to false for an external registry', () => {
    // Given/When
    const options = resolvedOptions(new MetricsPlugin({ registry: 'default' }));

    // Then — the app already collects process metrics; duplicating is opt-in
    expect(options.registry).toBe('default');
    expect(options.collectDefaultMetrics).toBe(false);
  });

  it('should respect an explicit collectDefaultMetrics with an external registry', () => {
    // Given/When
    const options = resolvedOptions(new MetricsPlugin({ registry: 'default', collectDefaultMetrics: true }));

    // Then
    expect(options.collectDefaultMetrics).toBe(true);
  });

  it('should pass through a provided Registry instance', () => {
    // Given
    const custom = new promClient.Registry();

    // When
    const options = resolvedOptions(new MetricsPlugin({ registry: custom }));

    // Then
    expect(options.registry).toBe(custom);
  });
});
