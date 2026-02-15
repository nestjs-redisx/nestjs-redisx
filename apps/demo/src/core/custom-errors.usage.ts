import { RedisXError, ErrorCode } from '@nestjs-redisx/core';

export class CacheError extends RedisXError {
  constructor(message: string, cause?: Error) {
    super(message, ErrorCode.CACHE_OPERATION_FAILED, cause);
  }
}

export class LockAcquisitionError extends RedisXError {
  constructor(key: string, cause?: Error) {
    super(
      `Failed to acquire lock for key "${key}"`,
      ErrorCode.LOCK_ACQUISITION_FAILED,
      cause,
      { key },
    );
  }
}
