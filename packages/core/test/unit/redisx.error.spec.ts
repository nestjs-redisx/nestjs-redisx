import { describe, it, expect } from 'vitest';
import { RedisXError } from '../../src/errors/base.error';
import { ErrorCode } from '../../src/errors/error-codes';

describe('RedisXError', () => {
  describe('constructor', () => {
    it('should create error with message and code', () => {
      // Given
      const message = 'Test error';
      const code = ErrorCode.CONN_FAILED;

      // When
      const error = new RedisXError(message, code);

      // Then
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(RedisXError);
      expect(error.message).toBe(message);
      expect(error.code).toBe(code);
      expect(error.name).toBe('RedisXError');
      expect(error.timestamp).toBeInstanceOf(Date);
    });

    it('should preserve cause error', () => {
      // Given
      const originalError = new Error('Original error');
      const error = new RedisXError('Wrapped error', ErrorCode.UNKNOWN, originalError);

      // When & Then
      expect(error.cause).toBe(originalError);
    });

    it('should store context', () => {
      // Given
      const context = { key: 'value', count: 42 };
      const error = new RedisXError('Error with context', ErrorCode.UNKNOWN, undefined, context);

      // When & Then
      expect(error.context).toEqual(context);
    });
  });

  describe('is', () => {
    it('should return true for matching code', () => {
      // Given
      const error = new RedisXError('Test', ErrorCode.CACHE_KEY_INVALID);

      // When & Then
      expect(error.is(ErrorCode.CACHE_KEY_INVALID)).toBe(true);
      expect(error.is(ErrorCode.LOCK_ACQUISITION_FAILED)).toBe(false);
    });
  });

  describe('isAnyOf', () => {
    it('should return true if code matches any in array', () => {
      // Given
      const error = new RedisXError('Test', ErrorCode.CACHE_KEY_INVALID);
      const codes = [ErrorCode.CACHE_KEY_INVALID, ErrorCode.CACHE_KEY_TOO_LONG];

      // When & Then
      expect(error.isAnyOf(codes)).toBe(true);
      expect(error.isAnyOf([ErrorCode.LOCK_ACQUISITION_FAILED])).toBe(false);
    });
  });

  describe('toJSON', () => {
    it('should serialize to JSON', () => {
      // Given
      const cause = new Error('Original');
      const context = { key: 'value' };
      const error = new RedisXError('Test error', ErrorCode.OP_FAILED, cause, context);

      // When
      const json = error.toJSON();

      // Then
      expect(json.name).toBe('RedisXError');
      expect(json.message).toBe('Test error');
      expect(json.code).toBe(ErrorCode.OP_FAILED);
      expect(json.context).toEqual(context);
      expect(json.cause).toBeDefined();
      expect((json.cause as Record<string, unknown>).message).toBe('Original');
      expect(json.timestamp).toBeDefined();
    });
  });

  describe('toString', () => {
    it('should create error string', () => {
      // Given
      const error = new RedisXError('Test error', ErrorCode.CACHE_KEY_INVALID);

      // When
      const str = error.toString();

      // Then
      expect(str).toBe('RedisXError [CACHE_KEY_INVALID]: Test error');
    });

    it('should include cause in string', () => {
      // Given
      const cause = new Error('Original error');
      const error = new RedisXError('Wrapped', ErrorCode.UNKNOWN, cause);

      // When
      const str = error.toString();

      // Then
      expect(str).toContain('Wrapped');
      expect(str).toContain('Caused by: Original error');
    });
  });

  describe('wrap', () => {
    it('should return RedisXError as is', () => {
      // Given
      const original = new RedisXError('Test', ErrorCode.CACHE_KEY_INVALID);

      // When
      const wrapped = RedisXError.wrap(original);

      // Then
      expect(wrapped).toBe(original);
    });

    it('should wrap Error in RedisXError', () => {
      // Given
      const original = new Error('Original error');

      // When
      const wrapped = RedisXError.wrap(original, ErrorCode.OP_FAILED);

      // Then
      expect(wrapped).toBeInstanceOf(RedisXError);
      expect(wrapped.message).toBe('Original error');
      expect(wrapped.code).toBe(ErrorCode.OP_FAILED);
      expect(wrapped.cause).toBe(original);
    });

    it('should wrap unknown error', () => {
      // Given
      const original = 'String error';

      // When
      const wrapped = RedisXError.wrap(original);

      // Then
      expect(wrapped).toBeInstanceOf(RedisXError);
      expect(wrapped.message).toBe('String error');
      expect(wrapped.code).toBe(ErrorCode.UNKNOWN);
      expect(wrapped.context?.originalError).toBe(original);
    });
  });

  describe('isRedisXError', () => {
    it('should return true for RedisXError', () => {
      // Given
      const error = new RedisXError('Test', ErrorCode.UNKNOWN);

      // When & Then
      expect(RedisXError.isRedisXError(error)).toBe(true);
    });

    it('should return false for regular Error', () => {
      // Given
      const error = new Error('Test');

      // When & Then
      expect(RedisXError.isRedisXError(error)).toBe(false);
    });

    it('should return false for non-errors', () => {
      // When & Then
      expect(RedisXError.isRedisXError('string')).toBe(false);
      expect(RedisXError.isRedisXError(null)).toBe(false);
      expect(RedisXError.isRedisXError(undefined)).toBe(false);
    });
  });
});
