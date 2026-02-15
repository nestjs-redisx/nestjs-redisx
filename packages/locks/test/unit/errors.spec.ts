import { describe, it, expect } from 'vitest';
import { ErrorCode } from '@nestjs-redisx/core';
import { LockError, LockAcquisitionError, LockNotOwnedError, LockExtensionError, LockExpiredError } from '../../src/shared/errors';

describe('Lock Errors', () => {
  describe('LockError', () => {
    it('should create lock error with message and key', () => {
      // Given
      const message = 'Lock error occurred';
      const key = 'test-lock';

      // When
      const error = new LockError(message, ErrorCode.LOCK_ACQUISITION_FAILED, key);

      // Then
      expect(error).toBeInstanceOf(LockError);
      expect(error.message).toBe(message);
      expect(error.lockKey).toBe(key);
      expect(error.code).toBe(ErrorCode.LOCK_ACQUISITION_FAILED);
    });

    it('should create lock error with cause', () => {
      // Given
      const cause = new Error('Original error');
      const key = 'test-lock';

      // When
      const error = new LockError('Lock failed', ErrorCode.LOCK_ACQUISITION_FAILED, key, cause);

      // Then
      expect(error.cause).toBe(cause);
    });
  });

  describe('LockAcquisitionError', () => {
    it('should create timeout acquisition error', () => {
      // Given
      const key = 'resource-123';

      // When
      const error = new LockAcquisitionError(key, 'timeout');

      // Then
      expect(error).toBeInstanceOf(LockAcquisitionError);
      expect(error.lockKey).toBe(key);
      expect(error.reason).toBe('timeout');
      expect(error.code).toBe(ErrorCode.LOCK_ACQUISITION_TIMEOUT);
      expect(error.message).toContain('timeout');
    });

    it('should create held acquisition error', () => {
      // Given
      const key = 'resource-123';

      // When
      const error = new LockAcquisitionError(key, 'held');

      // Then
      expect(error.reason).toBe('held');
      expect(error.code).toBe(ErrorCode.LOCK_ACQUISITION_FAILED);
      expect(error.message).toContain('held');
    });

    it('should create error acquisition error', () => {
      // Given
      const key = 'resource-123';
      const cause = new Error('Redis error');

      // When
      const error = new LockAcquisitionError(key, 'error', cause);

      // Then
      expect(error.reason).toBe('error');
      expect(error.code).toBe(ErrorCode.LOCK_ACQUISITION_FAILED);
      expect(error.cause).toBe(cause);
    });
  });

  describe('LockNotOwnedError', () => {
    it('should create not owned error', () => {
      // Given
      const key = 'resource-123';
      const token = 'token-456';

      // When
      const error = new LockNotOwnedError(key, token);

      // Then
      expect(error).toBeInstanceOf(LockNotOwnedError);
      expect(error.lockKey).toBe(key);
      expect(error.token).toBe(token);
      expect(error.code).toBe(ErrorCode.LOCK_NOT_OWNED);
      expect(error.message).toContain(key);
      expect(error.message).toContain(token);
    });

    it('should serialize to JSON with token', () => {
      // Given
      const key = 'resource-123';
      const token = 'token-456';
      const error = new LockNotOwnedError(key, token);

      // When
      const json = error.toJSON();

      // Then
      expect(json.token).toBe(token);
      expect(json.message).toContain(key);
    });
  });

  describe('LockExtensionError', () => {
    it('should create extension error', () => {
      // Given
      const key = 'resource-123';
      const token = 'token-456';

      // When
      const error = new LockExtensionError(key, token);

      // Then
      expect(error).toBeInstanceOf(LockExtensionError);
      expect(error.lockKey).toBe(key);
      expect(error.token).toBe(token);
      expect(error.code).toBe(ErrorCode.LOCK_EXTENSION_FAILED);
      expect(error.message).toContain('extend');
    });

    it('should create extension error with cause', () => {
      // Given
      const key = 'resource-123';
      const token = 'token-456';
      const cause = new Error('Redis connection lost');

      // When
      const error = new LockExtensionError(key, token, cause);

      // Then
      expect(error.cause).toBe(cause);
    });

    it('should serialize to JSON with token', () => {
      // Given
      const key = 'resource-123';
      const token = 'token-456';
      const error = new LockExtensionError(key, token);

      // When
      const json = error.toJSON();

      // Then
      expect(json.token).toBe(token);
    });
  });

  describe('LockExpiredError', () => {
    it('should create expired error', () => {
      // Given
      const key = 'resource-123';

      // When
      const error = new LockExpiredError(key);

      // Then
      expect(error).toBeInstanceOf(LockExpiredError);
      expect(error.lockKey).toBe(key);
      expect(error.code).toBe(ErrorCode.LOCK_EXPIRED);
      expect(error.message).toContain('expired');
      expect(error.message).toContain(key);
    });
  });
});
