import { describe, it, expect } from 'vitest';
import { ErrorCode } from '@nestjs-redisx/core';
import { CacheError, CacheKeyError, SerializationError, LoaderError, StampedeError, TagInvalidationError } from '../../src/shared/errors';

describe('Cache Errors', () => {
  describe('CacheError', () => {
    it('should create error with message and code', () => {
      // Given
      const message = 'Cache operation failed';
      const code = ErrorCode.OPERATION_FAILED;

      // When
      const error = new CacheError(message, code);

      // Then
      expect(error.name).toBe('CacheError');
      expect(error.message).toBe(message);
      expect(error.code).toBe(code);
    });

    it('should default to OPERATION_FAILED code', () => {
      // Given
      const message = 'Cache error';

      // When
      const error = new CacheError(message);

      // Then
      expect(error.code).toBe(ErrorCode.OPERATION_FAILED);
    });

    it('should include cause error', () => {
      // Given
      const cause = new Error('Root cause');

      // When
      const error = new CacheError('Failed', ErrorCode.OPERATION_FAILED, cause);

      // Then
      expect(error.cause).toBe(cause);
    });
  });

  describe('CacheKeyError', () => {
    it('should create error with key and message', () => {
      // Given
      const key = 'invalid:key';
      const message = 'key contains invalid characters';

      // When
      const error = new CacheKeyError(key, message);

      // Then
      expect(error.name).toBe('CacheKeyError');
      expect(error.key).toBe(key);
      expect(error.message).toContain(key);
      expect(error.message).toContain(message);
      expect(error.code).toBe(ErrorCode.CACHE_KEY_INVALID);
    });
  });

  describe('SerializationError', () => {
    it('should create error with message', () => {
      // Given
      const message = 'Cannot serialize circular structure';

      // When
      const error = new SerializationError(message);

      // Then
      expect(error.name).toBe('SerializationError');
      expect(error.message).toContain('Serialization error');
      expect(error.message).toContain(message);
      expect(error.code).toBe(ErrorCode.SERIALIZATION_FAILED);
    });

    it('should include cause error', () => {
      // Given
      const cause = new TypeError('Circular reference');

      // When
      const error = new SerializationError('Failed', cause);

      // Then
      expect(error.cause).toBe(cause);
    });
  });

  describe('LoaderError', () => {
    it('should create error with key and cause', () => {
      // Given
      const key = 'user:123';
      const cause = new Error('Database connection failed');

      // When
      const error = new LoaderError(key, cause);

      // Then
      expect(error.name).toBe('LoaderError');
      expect(error.key).toBe(key);
      expect(error.message).toContain(key);
      expect(error.message).toContain(cause.message);
      expect(error.cause).toBe(cause);
      expect(error.code).toBe(ErrorCode.OPERATION_FAILED);
    });
  });

  describe('StampedeError', () => {
    it('should create error with key and timeout', () => {
      // Given
      const key = 'popular:item';
      const timeout = 5000;

      // When
      const error = new StampedeError(key, timeout);

      // Then
      expect(error.name).toBe('StampedeError');
      expect(error.key).toBe(key);
      expect(error.timeout).toBe(timeout);
      expect(error.message).toContain(key);
      expect(error.message).toContain(timeout.toString());
      expect(error.code).toBe(ErrorCode.OPERATION_TIMEOUT);
    });
  });

  describe('TagInvalidationError', () => {
    it('should create error with tag and message', () => {
      // Given
      const tag = 'users';
      const message = 'Redis connection lost';

      // When
      const error = new TagInvalidationError(tag, message);

      // Then
      expect(error.name).toBe('TagInvalidationError');
      expect(error.tag).toBe(tag);
      expect(error.message).toContain(tag);
      expect(error.message).toContain(message);
      expect(error.code).toBe(ErrorCode.OPERATION_FAILED);
    });

    it('should include cause error', () => {
      // Given
      const tag = 'products';
      const cause = new Error('Network error');

      // When
      const error = new TagInvalidationError(tag, 'Failed', cause);

      // Then
      expect(error.cause).toBe(cause);
    });
  });
});
