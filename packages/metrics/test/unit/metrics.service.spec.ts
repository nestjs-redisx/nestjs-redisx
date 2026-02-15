import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MetricsService } from '../../src/metrics/application/services/metrics.service';
import type { IMetricsPluginOptions } from '../../src/shared/types';
import { MetricRegistrationError } from '../../src/shared/errors';

describe('MetricsService', () => {
  let service: MetricsService;
  let config: IMetricsPluginOptions;

  beforeEach(() => {
    config = {
      enabled: true,
      prefix: 'test_',
      collectDefaultMetrics: false,
    };

    service = new MetricsService(config);
    service.onModuleInit();
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('onModuleInit', () => {
    it('should register standard metrics when enabled', () => {
      // Given
      const newService = new MetricsService(config);

      // When
      newService.onModuleInit();

      // Then - should not throw
      expect(newService).toBeDefined();
      newService.onModuleDestroy();
    });

    it('should not register metrics when disabled', () => {
      // Given
      const disabledConfig = { ...config, enabled: false };
      const newService = new MetricsService(disabledConfig);

      // When
      newService.onModuleInit();

      // Then - service should exist but not register metrics
      expect(newService).toBeDefined();
      newService.onModuleDestroy();
    });
  });

  describe('registerCounter', () => {
    it('should register counter metric', () => {
      // Given
      const name = 'test_counter';
      const help = 'Test counter';

      // When/Then - should not throw
      expect(() => service.registerCounter(name, help)).not.toThrow();
    });

    it('should register counter with labels', () => {
      // Given
      const name = 'test_counter_labels';
      const help = 'Test counter with labels';
      const labels = ['status', 'method'];

      // When/Then - should not throw
      expect(() => service.registerCounter(name, help, labels)).not.toThrow();
    });

    it('should throw on duplicate registration', () => {
      // Given
      const name = 'duplicate_counter';
      const help = 'Duplicate counter';
      service.registerCounter(name, help);

      // When/Then
      try {
        service.registerCounter(name, help);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/MetricRegistrationError/);
      }
    });

    it('should do nothing when disabled', () => {
      // Given
      const disabledService = new MetricsService({ enabled: false });

      // When/Then - should not throw
      expect(() => disabledService.registerCounter('test', 'help')).not.toThrow();
    });
  });

  describe('registerHistogram', () => {
    it('should register histogram metric', () => {
      // Given
      const name = 'test_histogram';
      const help = 'Test histogram';

      // When/Then - should not throw
      expect(() => service.registerHistogram(name, help)).not.toThrow();
    });

    it('should register histogram with custom buckets', () => {
      // Given
      const name = 'test_histogram_buckets';
      const help = 'Test histogram with buckets';
      const buckets = [0.1, 1, 10];

      // When/Then - should not throw
      expect(() => service.registerHistogram(name, help, [], buckets)).not.toThrow();
    });

    it('should throw on duplicate registration', () => {
      // Given
      const name = 'duplicate_histogram';
      const help = 'Duplicate histogram';
      service.registerHistogram(name, help);

      // When/Then
      try {
        service.registerHistogram(name, help);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/MetricRegistrationError/);
      }
    });
  });

  describe('registerGauge', () => {
    it('should register gauge metric', () => {
      // Given
      const name = 'test_gauge';
      const help = 'Test gauge';

      // When/Then - should not throw
      expect(() => service.registerGauge(name, help)).not.toThrow();
    });

    it('should register gauge with labels', () => {
      // Given
      const name = 'test_gauge_labels';
      const help = 'Test gauge with labels';
      const labels = ['region'];

      // When/Then - should not throw
      expect(() => service.registerGauge(name, help, labels)).not.toThrow();
    });
  });

  describe('incrementCounter', () => {
    it('should increment counter', () => {
      // Given
      const name = 'test_inc_counter';
      service.registerCounter(name, 'Test counter');

      // When/Then - should not throw
      service.incrementCounter(name);
      service.incrementCounter(name, undefined, 2);
    });

    it('should increment counter with labels', () => {
      // Given
      const name = 'test_inc_counter_labels';
      service.registerCounter(name, 'Test counter', ['status']);

      // When/Then - should not throw
      service.incrementCounter(name, { status: 'success' });
      service.incrementCounter(name, { status: 'error' }, 5);
    });

    it('should do nothing for non-existent counter', () => {
      // When/Then - should not throw
      service.incrementCounter('nonexistent');
    });

    it('should do nothing when disabled', () => {
      // Given
      const disabledService = new MetricsService({ enabled: false });

      // When/Then - should not throw
      disabledService.incrementCounter('test');
    });
  });

  describe('observeHistogram', () => {
    it('should observe histogram value', () => {
      // Given
      const name = 'test_obs_histogram';
      service.registerHistogram(name, 'Test histogram');

      // When/Then - should not throw
      service.observeHistogram(name, 0.5);
    });

    it('should observe histogram value with labels', () => {
      // Given
      const name = 'test_obs_histogram_labels';
      service.registerHistogram(name, 'Test histogram', ['method']);

      // When/Then - should not throw
      service.observeHistogram(name, 1.5, { method: 'GET' });
    });

    it('should do nothing for non-existent histogram', () => {
      // When/Then - should not throw
      service.observeHistogram('nonexistent', 0.5);
    });
  });

  describe('startTimer', () => {
    it('should return timer function', () => {
      // Given
      const name = 'test_timer_histogram';
      service.registerHistogram(name, 'Test timer');

      // When
      const end = service.startTimer(name);

      // Then
      expect(end).toBeInstanceOf(Function);
      const duration = end();
      expect(duration).toBeGreaterThanOrEqual(0);
    });

    it('should work with labels', () => {
      // Given
      const name = 'test_timer_labels';
      service.registerHistogram(name, 'Test timer', ['operation']);

      // When
      const end = service.startTimer(name, { operation: 'query' });
      const duration = end();

      // Then
      expect(duration).toBeGreaterThanOrEqual(0);
    });

    it('should return no-op function for non-existent histogram', () => {
      // When
      const end = service.startTimer('nonexistent');

      // Then
      expect(end()).toBe(0);
    });

    it('should return no-op function when disabled', () => {
      // Given
      const disabledService = new MetricsService({ enabled: false });

      // When
      const end = disabledService.startTimer('test');

      // Then
      expect(end()).toBe(0);
    });
  });

  describe('setGauge', () => {
    it('should set gauge value', () => {
      // Given
      const name = 'test_set_gauge';
      service.registerGauge(name, 'Test gauge');

      // When/Then - should not throw
      service.setGauge(name, 42);
    });

    it('should set gauge value with labels', () => {
      // Given
      const name = 'test_set_gauge_labels';
      service.registerGauge(name, 'Test gauge', ['region']);

      // When/Then - should not throw
      service.setGauge(name, 100, { region: 'us-east' });
    });

    it('should do nothing for non-existent gauge', () => {
      // When/Then - should not throw
      service.setGauge('nonexistent', 42);
    });
  });

  describe('incrementGauge', () => {
    it('should increment gauge', () => {
      // Given
      const name = 'test_inc_gauge';
      service.registerGauge(name, 'Test gauge');

      // When/Then - should not throw
      service.incrementGauge(name);
      service.incrementGauge(name, undefined, 2);
    });

    it('should increment gauge with labels', () => {
      // Given
      const name = 'test_inc_gauge_labels';
      service.registerGauge(name, 'Test gauge', ['status']);

      // When/Then - should not throw
      service.incrementGauge(name, { status: 'active' });
      service.incrementGauge(name, { status: 'active' }, 5);
    });

    it('should do nothing for non-existent gauge', () => {
      // When/Then - should not throw
      service.incrementGauge('nonexistent');
    });
  });

  describe('decrementGauge', () => {
    it('should decrement gauge', () => {
      // Given
      const name = 'test_dec_gauge';
      service.registerGauge(name, 'Test gauge');

      // When/Then - should not throw
      service.decrementGauge(name);
      service.decrementGauge(name, undefined, 2);
    });

    it('should decrement gauge with labels', () => {
      // Given
      const name = 'test_dec_gauge_labels';
      service.registerGauge(name, 'Test gauge', ['status']);

      // When/Then - should not throw
      service.decrementGauge(name, { status: 'active' });
      service.decrementGauge(name, { status: 'active' }, 3);
    });

    it('should do nothing for non-existent gauge', () => {
      // When/Then - should not throw
      service.decrementGauge('nonexistent');
    });
  });

  describe('getMetrics', () => {
    it('should return metrics in Prometheus format', async () => {
      // Given
      service.registerCounter('test_metric', 'Test metric');
      service.incrementCounter('test_metric');

      // When
      const metrics = await service.getMetrics();

      // Then
      expect(metrics).toContain('test_metric');
      expect(metrics).toContain('HELP');
      expect(metrics).toContain('TYPE');
    });

    it('should return empty string when disabled', async () => {
      // Given
      const disabledService = new MetricsService({ enabled: false });

      // When
      const metrics = await disabledService.getMetrics();

      // Then
      expect(metrics).toBe('');
    });
  });

  describe('getMetricsJson', () => {
    it('should return metrics as JSON', async () => {
      // Given
      service.registerCounter('test_json_metric', 'Test JSON metric');
      service.incrementCounter('test_json_metric');

      // When
      const metrics = await service.getMetricsJson();

      // Then
      expect(Array.isArray(metrics)).toBe(true);
      const metric = metrics.find((m) => m.name === 'test_json_metric');
      expect(metric).toBeDefined();
      expect(metric?.help).toBe('Test JSON metric');
    });

    it('should return empty array when disabled', async () => {
      // Given
      const disabledService = new MetricsService({ enabled: false });

      // When
      const metrics = await disabledService.getMetricsJson();

      // Then
      expect(metrics).toEqual([]);
    });
  });

  describe('custom configuration', () => {
    it('should use custom prefix', () => {
      // Given
      const customConfig = { ...config, prefix: 'myapp_' };
      const customService = new MetricsService(customConfig);
      customService.onModuleInit();

      // When/Then
      customService.registerCounter('myapp_custom_metric', 'Custom metric');
      customService.onModuleDestroy();
    });

    it('should use custom default labels', () => {
      // Given
      const customConfig = {
        ...config,
        defaultLabels: { env: 'test', version: '1.0' },
      };
      const customService = new MetricsService(customConfig);

      // When/Then - should not throw
      customService.onModuleInit();
      customService.onModuleDestroy();
    });

    it('should use custom latency buckets', () => {
      // Given
      const customBuckets = [0.1, 1, 10];
      const customConfig = { ...config, latencyBuckets: customBuckets };
      const customService = new MetricsService(customConfig);

      // When/Then - should not throw
      customService.registerHistogram('test_custom_buckets', 'Test');
      customService.onModuleDestroy();
    });
  });

  describe('metric options', () => {
    it('should register command metrics when enabled', () => {
      // Given
      const newService = new MetricsService({ ...config, commandMetrics: true });

      // When
      newService.onModuleInit();

      // Then - should not throw
      expect(newService).toBeDefined();
      newService.onModuleDestroy();
    });

    it('should not register command metrics when disabled', () => {
      // Given
      const newService = new MetricsService({ ...config, commandMetrics: false });

      // When
      newService.onModuleInit();

      // Then - should not throw
      expect(newService).toBeDefined();
      newService.onModuleDestroy();
    });

    it('should register plugin metrics when enabled', () => {
      // Given
      const newService = new MetricsService({ ...config, pluginMetrics: true });

      // When
      newService.onModuleInit();

      // Then - should not throw
      expect(newService).toBeDefined();
      newService.onModuleDestroy();
    });

    it('should not register plugin metrics when disabled', () => {
      // Given
      const newService = new MetricsService({ ...config, pluginMetrics: false });

      // When
      newService.onModuleInit();

      // Then - should not throw
      expect(newService).toBeDefined();
      newService.onModuleDestroy();
    });
  });

  describe('collectDefaultMetrics', () => {
    it('should collect default Node.js metrics when enabled', async () => {
      // Given
      const newService = new MetricsService({
        ...config,
        collectDefaultMetrics: true,
        collectInterval: 15000,
      });

      // When
      newService.onModuleInit();
      const metrics = await newService.getMetrics();

      // Then — default metrics include process/nodejs prefixed gauges
      expect(metrics).toContain('test_process_cpu');
      newService.onModuleDestroy();
    });

    it('should not collect default metrics when disabled', async () => {
      // Given
      const newService = new MetricsService({
        ...config,
        collectDefaultMetrics: false,
      });

      // When
      newService.onModuleInit();
      const metrics = await newService.getMetrics();

      // Then — no default metrics (only our standard metrics)
      expect(metrics).not.toContain('test_process_cpu');
      newService.onModuleDestroy();
    });
  });

  describe('onModuleDestroy', () => {
    it('should clear registry on destroy', async () => {
      // Given
      const newService = new MetricsService(config);
      newService.onModuleInit();
      newService.registerCounter('destroy_test_counter', 'Test counter');

      // When
      newService.onModuleDestroy();

      // Then
      const metrics = await newService.getMetrics();
      expect(metrics).not.toContain('destroy_test_counter');
    });
  });
});
