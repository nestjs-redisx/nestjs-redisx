import { describe, it, expect, afterEach } from 'vitest';
import * as promClient from 'prom-client';
import { MetricsService } from '../../src/metrics/application/services/metrics.service';
import { MetricRegistrationError } from '../../src/shared/errors';

describe('MetricsService edge cases', () => {
  let service: MetricsService | undefined;

  afterEach(() => {
    service?.onModuleDestroy();
    service = undefined;
    promClient.register.clear();
  });

  describe('disabled service', () => {
    function buildDisabled(): MetricsService {
      service = new MetricsService({ enabled: false });
      return service;
    }

    it('should no-op all registration methods', async () => {
      // Given
      const svc = buildDisabled();
      svc.onModuleInit();

      // When
      svc.registerCounter('redisx_disabled_counter', 'c');
      svc.registerHistogram('redisx_disabled_histogram', 'h');
      svc.registerGauge('redisx_disabled_gauge', 'g');

      // Then
      await expect(svc.getMetrics()).resolves.toBe('');
      await expect(svc.getMetricsJson()).resolves.toEqual([]);
    });

    it('should no-op all observation methods', () => {
      // Given
      const svc = buildDisabled();

      // When / Then — nothing throws, nothing recorded
      svc.incrementCounter('any', { a: 'b' });
      svc.observeHistogram('any', 1, { a: 'b' });
      svc.setGauge('any', 1, { a: 'b' });
      svc.incrementGauge('any', { a: 'b' });
      svc.decrementGauge('any', { a: 'b' });
      expect(svc.startTimer('any')()).toBe(0);
    });
  });

  describe('registration collisions', () => {
    it('should wrap duplicate registrations in MetricRegistrationError for every metric type', () => {
      // Given
      service = new MetricsService({ commandMetrics: false, pluginMetrics: false, collectDefaultMetrics: false });
      service.onModuleInit();
      service.registerCounter('redisx_dup_counter', 'c');
      service.registerHistogram('redisx_dup_histogram', 'h');
      service.registerGauge('redisx_dup_gauge', 'g');

      // When / Then
      expect(() => service!.registerCounter('redisx_dup_counter', 'c')).toThrow(MetricRegistrationError);
      expect(() => service!.registerHistogram('redisx_dup_histogram', 'h')).toThrow(MetricRegistrationError);
      expect(() => service!.registerGauge('redisx_dup_gauge', 'g')).toThrow(MetricRegistrationError);
    });
  });

  describe('collectInterval', () => {
    it('should collect default metrics without a timeout when collectInterval is 0', async () => {
      // Given / When
      service = new MetricsService({ commandMetrics: false, pluginMetrics: false, collectDefaultMetrics: true, collectInterval: 0 });
      service.onModuleInit();

      // Then
      await expect(service.getMetrics()).resolves.toContain('redisx_process_cpu_user_seconds_total');
    });
  });
});
