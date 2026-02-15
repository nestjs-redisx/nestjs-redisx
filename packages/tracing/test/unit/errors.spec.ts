import { describe, it, expect } from 'vitest';
import { ErrorCode } from '@nestjs-redisx/core';
import { TracingError, TracingInitializationError, SpanCreationError } from '../../src/shared/errors';

describe('Tracing Errors', () => {
  describe('TracingError', () => {
    it('should create error with message', () => {
      // Given
      const message = 'Tracing operation failed';

      // When
      const error = new TracingError(message);

      // Then
      expect(error).toBeInstanceOf(TracingError);
      expect(error.message).toBe(message);
      expect(error.code).toBe(ErrorCode.OP_FAILED);
    });

    it('should create error with cause', () => {
      // Given
      const message = 'Tracing error';
      const cause = new Error('Original error');

      // When
      const error = new TracingError(message, cause);

      // Then
      expect(error.cause).toBe(cause);
    });
  });

  describe('TracingInitializationError', () => {
    it('should create initialization error', () => {
      // Given/When
      const error = new TracingInitializationError();

      // Then
      expect(error).toBeInstanceOf(TracingInitializationError);
      expect(error.message).toContain('Failed to initialize');
      expect(error.code).toBe(ErrorCode.OP_FAILED);
    });

    it('should create initialization error with cause', () => {
      // Given
      const cause = new Error('Provider error');

      // When
      const error = new TracingInitializationError(cause);

      // Then
      expect(error.cause).toBe(cause);
    });
  });

  describe('SpanCreationError', () => {
    it('should create span creation error', () => {
      // Given
      const spanName = 'redis.command';

      // When
      const error = new SpanCreationError(spanName);

      // Then
      expect(error).toBeInstanceOf(SpanCreationError);
      expect(error.message).toContain('Failed to create span');
      expect(error.message).toContain(spanName);
      expect(error.code).toBe(ErrorCode.OP_FAILED);
    });

    it('should create span creation error with cause', () => {
      // Given
      const spanName = 'cache.get';
      const cause = new Error('Tracer not initialized');

      // When
      const error = new SpanCreationError(spanName, cause);

      // Then
      expect(error.cause).toBe(cause);
      expect(error.message).toContain(spanName);
    });
  });
});
