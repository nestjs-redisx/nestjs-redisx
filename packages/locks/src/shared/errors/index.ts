import { RedisXError, ErrorCode } from '@nestjs-redisx/core';

/**
 * Base error class for all lock-related errors.
 */
export class LockError extends RedisXError {
  constructor(
    message: string,
    code: ErrorCode,
    public readonly lockKey: string,
    cause?: Error,
  ) {
    super(message, code, cause, { lockKey });
  }
}

/**
 * Error thrown when lock acquisition fails.
 */
export class LockAcquisitionError extends LockError {
  constructor(
    key: string,
    public readonly reason: 'timeout' | 'held' | 'error',
    cause?: Error,
  ) {
    super(`Failed to acquire lock "${key}": ${reason}`, reason === 'timeout' ? ErrorCode.LOCK_ACQUISITION_TIMEOUT : ErrorCode.LOCK_ACQUISITION_FAILED, key, cause);
  }
}

/**
 * Error thrown when attempting to release or extend a lock not owned by the caller.
 */
export class LockNotOwnedError extends LockError {
  constructor(
    key: string,
    public readonly token: string,
  ) {
    super(`Lock "${key}" not owned by token "${token}"`, ErrorCode.LOCK_NOT_OWNED, key);
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      token: this.token,
    };
  }
}

/**
 * Error thrown when lock extension fails.
 */
export class LockExtensionError extends LockError {
  constructor(
    key: string,
    public readonly token: string,
    cause?: Error,
  ) {
    super(`Failed to extend lock "${key}"`, ErrorCode.LOCK_EXTENSION_FAILED, key, cause);
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      token: this.token,
    };
  }
}

/**
 * Error thrown when a lock has expired.
 */
export class LockExpiredError extends LockError {
  constructor(key: string) {
    super(`Lock "${key}" expired`, ErrorCode.LOCK_EXPIRED, key);
  }
}
