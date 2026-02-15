import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';
import { MetricsController } from '../../src/metrics/api/controllers/metrics.controller';
import type { IMetricsService } from '../../src/metrics/application/ports/metrics-service.port';

describe('MetricsController', () => {
  let controller: MetricsController;
  let mockService: MockedObject<IMetricsService>;

  beforeEach(() => {
    mockService = {
      getMetrics: vi.fn(),
      getMetricsJson: vi.fn(),
      incrementCounter: vi.fn(),
      observeHistogram: vi.fn(),
      startTimer: vi.fn(),
      setGauge: vi.fn(),
      incrementGauge: vi.fn(),
      decrementGauge: vi.fn(),
      registerCounter: vi.fn(),
      registerHistogram: vi.fn(),
      registerGauge: vi.fn(),
    } as unknown as MockedObject<IMetricsService>;

    controller = new MetricsController(mockService);
  });

  describe('getMetrics', () => {
    it('should return metrics in Prometheus format', async () => {
      // Given
      const metricsText = `# HELP test_metric Test metric
# TYPE test_metric counter
test_metric 42
`;
      mockService.getMetrics.mockResolvedValue(metricsText);

      // When
      const result = await controller.getMetrics();

      // Then
      expect(result).toBe(metricsText);
      expect(mockService.getMetrics).toHaveBeenCalledOnce();
    });

    it('should return empty string when no metrics', async () => {
      // Given
      mockService.getMetrics.mockResolvedValue('');

      // When
      const result = await controller.getMetrics();

      // Then
      expect(result).toBe('');
    });

    it('should handle service errors', async () => {
      // Given
      const error = new Error('Service error');
      mockService.getMetrics.mockRejectedValue(error);

      // When/Then
      await expect(controller.getMetrics()).rejects.toThrow('Service error');
    });
  });
});
