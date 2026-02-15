import { describe, it, expect } from 'vitest';
import { ErrorCode } from '@nestjs-redisx/core';
import { IdempotencyError, IdempotencyKeyRequiredError, IdempotencyFingerprintMismatchError, IdempotencyTimeoutError, IdempotencyFailedError, IdempotencyRecordNotFoundError } from '../../src/shared/errors';

describe('Idempotency Errors', () => {
  describe('IdempotencyError', () => {
    it('should create error with key', () => {
      // Given
      const key = 'test-key-123';
      const message = 'Idempotency error';

      // When
      const error = new IdempotencyError(message, ErrorCode.IDEMPOTENCY_KEY_INVALID, key);

      // Then
      expect(error).toBeInstanceOf(IdempotencyError);
      expect(error.message).toBe(message);
      expect(error.idempotencyKey).toBe(key);
      expect(error.code).toBe(ErrorCode.IDEMPOTENCY_KEY_INVALID);
    });

    it('should create error with cause', () => {
      // Given
      const cause = new Error('Original error');

      // When
      const error = new IdempotencyError('Error', ErrorCode.IDEMPOTENCY_KEY_INVALID, 'key', cause);

      // Then
      expect(error.cause).toBe(cause);
    });
  });

  describe('IdempotencyKeyRequiredError', () => {
    it('should create key required error', () => {
      // Given/When
      const error = new IdempotencyKeyRequiredError();

      // Then
      expect(error).toBeInstanceOf(IdempotencyKeyRequiredError);
      expect(error.message).toContain('required');
      expect(error.code).toBe(ErrorCode.IDEMPOTENCY_KEY_INVALID);
    });
  });

  describe('IdempotencyFingerprintMismatchError', () => {
    it('should create fingerprint mismatch error', () => {
      // Given
      const key = 'req-123';

      // When
      const error = new IdempotencyFingerprintMismatchError(key);

      // Then
      expect(error).toBeInstanceOf(IdempotencyFingerprintMismatchError);
      expect(error.message).toContain('does not match');
      expect(error.message).toContain(key);
      expect(error.idempotencyKey).toBe(key);
      expect(error.code).toBe(ErrorCode.IDEMPOTENCY_KEY_INVALID);
    });
  });

  describe('IdempotencyTimeoutError', () => {
    it('should create timeout error', () => {
      // Given
      const key = 'req-456';

      // When
      const error = new IdempotencyTimeoutError(key);

      // Then
      expect(error).toBeInstanceOf(IdempotencyTimeoutError);
      expect(error.message).toContain('Timeout');
      expect(error.message).toContain(key);
      expect(error.idempotencyKey).toBe(key);
      expect(error.code).toBe(ErrorCode.OP_TIMEOUT);
    });
  });

  describe('IdempotencyFailedError', () => {
    it('should create failed error without details', () => {
      // Given
      const key = 'req-789';

      // When
      const error = new IdempotencyFailedError(key);

      // Then
      expect(error).toBeInstanceOf(IdempotencyFailedError);
      expect(error.message).toContain('failed');
      expect(error.message).toContain(key);
      expect(error.idempotencyKey).toBe(key);
      expect(error.code).toBe(ErrorCode.IDEMPOTENCY_PREVIOUS_FAILED);
    });

    it('should create failed error with details', () => {
      // Given
      const key = 'req-789';
      const errorMsg = 'Database connection lost';

      // When
      const error = new IdempotencyFailedError(key, errorMsg);

      // Then
      expect(error.message).toContain(errorMsg);
    });
  });

  describe('IdempotencyRecordNotFoundError', () => {
    it('should create not found error', () => {
      // Given
      const key = 'missing-key';

      // When
      const error = new IdempotencyRecordNotFoundError(key);

      // Then
      expect(error).toBeInstanceOf(IdempotencyRecordNotFoundError);
      expect(error.message).toContain('not found');
      expect(error.message).toContain(key);
      expect(error.idempotencyKey).toBe(key);
      expect(error.code).toBe(ErrorCode.OP_KEY_NOT_FOUND);
    });
  });
});
