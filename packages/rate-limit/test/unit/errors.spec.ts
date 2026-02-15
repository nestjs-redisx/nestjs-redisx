import { describe, it, expect } from 'vitest';
import { ErrorCode } from '@nestjs-redisx/core';
import { RateLimitError, RateLimitExceededError, RateLimitScriptError } from '../../src/shared/errors';
import type { RateLimitResult } from '../../src/shared/types';

describe('Rate Limit Errors', () => {
  describe('RateLimitError', () => {
    it('should create error with message and code', () => {
      // Given
      const message = 'Rate limit error occurred';
      const code = ErrorCode.RATE_LIMIT_EXCEEDED;

      // When
      const error = new RateLimitError(message, code);

      // Then
      expect(error).toBeInstanceOf(RateLimitError);
      expect(error.message).toBe(message);
      expect(error.code).toBe(code);
    });

    it('should create error with result', () => {
      // Given
      const result: IRateLimitResult = {
        allowed: false,
        limit: 10,
        remaining: 0,
        retryAfter: 60,
        resetTime: Date.now() + 60000,
      };

      // When
      const error = new RateLimitError('Rate limited', ErrorCode.RATE_LIMIT_EXCEEDED, result);

      // Then
      expect(error.result).toEqual(result);
    });

    it('should create error with cause', () => {
      // Given
      const cause = new Error('Original error');

      // When
      const error = new RateLimitError('Rate limit failed', ErrorCode.RATE_LIMIT_EXCEEDED, undefined, cause);

      // Then
      expect(error.cause).toBe(cause);
    });
  });

  describe('RateLimitExceededError', () => {
    it('should create exceeded error with result', () => {
      // Given
      const result: IRateLimitResult = {
        allowed: false,
        limit: 100,
        remaining: 0,
        retryAfter: 30,
        resetTime: Date.now() + 30000,
      };

      // When
      const error = new RateLimitExceededError('Too many requests', result);

      // Then
      expect(error).toBeInstanceOf(RateLimitExceededError);
      expect(error).toBeInstanceOf(RateLimitError);
      expect(error.code).toBe(ErrorCode.RATE_LIMIT_EXCEEDED);
      expect(error.result).toEqual(result);
    });

    it('should provide retryAfter getter', () => {
      // Given
      const result: IRateLimitResult = {
        allowed: false,
        limit: 100,
        remaining: 0,
        retryAfter: 45,
        resetTime: Date.now() + 45000,
      };

      // When
      const error = new RateLimitExceededError('Too many requests', result);

      // Then
      expect(error.retryAfter).toBe(45);
    });

    it('should return 0 when retryAfter is undefined', () => {
      // Given
      const result: IRateLimitResult = {
        allowed: false,
        limit: 100,
        remaining: 0,
        resetTime: Date.now(),
      };

      // When
      const error = new RateLimitExceededError('Too many requests', result);

      // Then
      expect(error.retryAfter).toBe(0);
    });

    it('should include message in error', () => {
      // Given
      const message = 'Request limit exceeded for user';
      const result: IRateLimitResult = {
        allowed: false,
        limit: 10,
        remaining: 0,
        retryAfter: 60,
        resetTime: Date.now() + 60000,
      };

      // When
      const error = new RateLimitExceededError(message, result);

      // Then
      expect(error.message).toBe(message);
    });
  });

  describe('RateLimitScriptError', () => {
    it('should create script error', () => {
      // Given
      const message = 'Lua script execution failed';

      // When
      const error = new RateLimitScriptError(message);

      // Then
      expect(error).toBeInstanceOf(RateLimitScriptError);
      expect(error).toBeInstanceOf(RateLimitError);
      expect(error.message).toBe(message);
      expect(error.code).toBe(ErrorCode.RATE_LIMIT_SCRIPT_ERROR);
    });

    it('should create script error with cause', () => {
      // Given
      const cause = new Error('Redis connection lost');
      const message = 'Script failed';

      // When
      const error = new RateLimitScriptError(message, cause);

      // Then
      expect(error.cause).toBe(cause);
    });

    it('should not have result field', () => {
      // Given/When
      const error = new RateLimitScriptError('Script error');

      // Then
      expect(error.result).toBeUndefined();
    });
  });
});
