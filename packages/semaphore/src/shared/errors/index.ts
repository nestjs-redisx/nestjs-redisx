import { RedisXError, ErrorCode } from '@nestjs-redisx/core';

/**
 * Base error class for all semaphore-related errors.
 */
export class SemaphoreError extends RedisXError {
  constructor(
    message: string,
    code: ErrorCode,
    public readonly semaphoreKey: string,
    cause?: Error,
  ) {
    super(message, code, cause, { semaphoreKey });
  }
}

/**
 * Error thrown when no permit could be acquired.
 */
export class SemaphoreAcquisitionError extends SemaphoreError {
  constructor(
    key: string,
    public readonly reason: 'timeout' | 'exhausted' | 'error',
    cause?: Error,
  ) {
    super(`Failed to acquire semaphore permit for "${key}": ${reason}`, reason === 'timeout' ? ErrorCode.SEMAPHORE_ACQUISITION_TIMEOUT : ErrorCode.SEMAPHORE_ACQUISITION_FAILED, key, cause);
  }
}

/**
 * Error thrown when releasing or extending a permit that is not held
 * (expired, already released, or force-released by an operator).
 */
export class SemaphorePermitNotHeldError extends SemaphoreError {
  constructor(
    key: string,
    public readonly permitId: string,
  ) {
    super(`Semaphore permit "${permitId}" on "${key}" is not held`, ErrorCode.SEMAPHORE_PERMIT_NOT_HELD, key);
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      permitId: this.permitId,
    };
  }
}

/**
 * Error thrown when a permit TTL extension fails.
 */
export class SemaphoreExtensionError extends SemaphoreError {
  constructor(
    key: string,
    public readonly permitId: string,
    cause?: Error,
  ) {
    super(`Failed to extend semaphore permit "${permitId}" on "${key}"`, ErrorCode.SEMAPHORE_EXTENSION_FAILED, key, cause);
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      permitId: this.permitId,
    };
  }
}

/**
 * Error thrown on invalid plugin or per-call configuration (fail-fast).
 */
export class InvalidSemaphoreConfigError extends RedisXError {
  constructor(message: string) {
    super(message, ErrorCode.SEMAPHORE_CONFIG_INVALID);
  }
}
