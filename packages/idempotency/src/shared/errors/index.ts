import { RedisXError, ErrorCode } from '@nestjs-redisx/core';

/**
 * Base class for all idempotency-related errors
 */
export class IdempotencyError extends RedisXError {
  constructor(
    message: string,
    code: ErrorCode,
    public readonly idempotencyKey: string,
    cause?: Error,
  ) {
    super(message, code, cause, { idempotencyKey });
  }
}

/**
 * Thrown when Idempotency-Key header is required but not provided
 */
export class IdempotencyKeyRequiredError extends IdempotencyError {
  constructor() {
    super('Idempotency-Key header is required', ErrorCode.IDEMPOTENCY_KEY_INVALID, '');
  }
}

/**
 * Thrown when request fingerprint doesn't match the stored one
 */
export class IdempotencyFingerprintMismatchError extends IdempotencyError {
  constructor(key: string) {
    super(`Request body does not match previous request with idempotency key "${key}"`, ErrorCode.IDEMPOTENCY_KEY_INVALID, key);
  }
}

/**
 * Thrown when timeout waiting for concurrent request to complete
 */
export class IdempotencyTimeoutError extends IdempotencyError {
  constructor(key: string) {
    super(`Timeout waiting for concurrent request with idempotency key "${key}"`, ErrorCode.OP_TIMEOUT, key);
  }
}

/**
 * Thrown when previous request with same key failed
 */
export class IdempotencyFailedError extends IdempotencyError {
  constructor(key: string, error?: string) {
    super(`Previous request with idempotency key "${key}" failed${error ? `: ${error}` : ''}`, ErrorCode.IDEMPOTENCY_PREVIOUS_FAILED, key);
  }
}

/**
 * Thrown when idempotency record not found in Redis
 */
export class IdempotencyRecordNotFoundError extends IdempotencyError {
  constructor(key: string) {
    super(`Idempotency record not found for key "${key}"`, ErrorCode.OP_KEY_NOT_FOUND, key);
  }
}
