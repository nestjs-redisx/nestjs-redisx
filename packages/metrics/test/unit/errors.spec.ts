import { describe, it, expect } from 'vitest';
import { ErrorCode } from '@nestjs-redisx/core';
import { MetricsError, MetricRegistrationError } from '../../src/shared/errors';

describe('Metrics Errors', () => {
  describe('MetricsError', () => {
    it('should create error with message', () => {
      // Given
      const message = 'Metrics operation failed';

      // When
      const error = new MetricsError(message);

      // Then
      expect(error).toBeInstanceOf(MetricsError);
      expect(error.message).toBe(message);
      expect(error.code).toBe(ErrorCode.OP_FAILED);
    });

    it('should create error with cause', () => {
      // Given
      const message = 'Metrics error';
      const cause = new Error('Original error');

      // When
      const error = new MetricsError(message, cause);

      // Then
      expect(error.cause).toBe(cause);
    });
  });

  describe('MetricRegistrationError', () => {
    it('should create registration error', () => {
      // Given
      const metricName = 'http_requests_total';

      // When
      const error = new MetricRegistrationError(metricName);

      // Then
      expect(error).toBeInstanceOf(MetricRegistrationError);
      expect(error.message).toContain('Failed to register metric');
      expect(error.message).toContain(metricName);
      expect(error.code).toBe(ErrorCode.OP_FAILED);
    });

    it('should create registration error with cause', () => {
      // Given
      const metricName = 'api_errors';
      const cause = new Error('Duplicate metric');

      // When
      const error = new MetricRegistrationError(metricName, cause);

      // Then
      expect(error.cause).toBe(cause);
      expect(error.message).toContain(metricName);
    });
  });
});
