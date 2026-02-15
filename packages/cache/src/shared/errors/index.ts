/**
 * Cache plugin error classes.
 */

import { RedisXError, ErrorCode } from '@nestjs-redisx/core';

/**
 * Base error for cache operations.
 */
export class CacheError extends RedisXError {
  constructor(message: string, code: ErrorCode = ErrorCode.OPERATION_FAILED, cause?: Error) {
    super(message, code, cause);
    this.name = 'CacheError';
  }
}

/**
 * Error for invalid cache keys.
 */
export class CacheKeyError extends CacheError {
  constructor(
    public readonly key: string,
    message: string,
  ) {
    super(`Invalid cache key "${key}": ${message}`, ErrorCode.CACHE_KEY_INVALID);
    this.name = 'CacheKeyError';
  }
}

/**
 * Error for serialization failures.
 */
export class SerializationError extends CacheError {
  constructor(message: string, cause?: Error) {
    super(`Serialization error: ${message}`, ErrorCode.SERIALIZATION_FAILED, cause);
    this.name = 'SerializationError';
  }
}

/**
 * Error for loader function failures.
 */
export class LoaderError extends CacheError {
  constructor(
    public readonly key: string,
    cause: Error,
  ) {
    super(`Loader failed for key "${key}": ${cause.message}`, ErrorCode.OPERATION_FAILED, cause);
    this.name = 'LoaderError';
  }
}

/**
 * Error for stampede protection timeout.
 */
export class StampedeError extends CacheError {
  constructor(
    public readonly key: string,
    public readonly timeout: number,
  ) {
    super(`Stampede protection timeout for key "${key}" after ${timeout}ms`, ErrorCode.OPERATION_TIMEOUT);
    this.name = 'StampedeError';
  }
}

/**
 * Error for tag invalidation failures.
 */
export class TagInvalidationError extends CacheError {
  constructor(
    public readonly tag: string,
    message: string,
    cause?: Error,
  ) {
    super(`Tag invalidation failed for "${tag}": ${message}`, ErrorCode.OPERATION_FAILED, cause);
    this.name = 'TagInvalidationError';
  }
}
