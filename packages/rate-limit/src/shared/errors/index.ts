import { RedisXError, ErrorCode } from '@nestjs-redisx/core';

import { IRateLimitResult } from '../types';

/**
 * Base error class for rate limit errors.
 */
export class RateLimitError extends RedisXError {
  constructor(
    message: string,
    code: ErrorCode,
    public readonly result?: IRateLimitResult,
    cause?: Error,
  ) {
    super(message, code, cause, { result });
  }
}

/**
 * Error thrown when rate limit is exceeded.
 */
export class RateLimitExceededError extends RateLimitError {
  constructor(message: string, result: IRateLimitResult) {
    super(message, ErrorCode.RATE_LIMIT_EXCEEDED, result);
  }

  /**
   * Seconds until retry is allowed.
   */
  get retryAfter(): number {
    return this.result?.retryAfter ?? 0;
  }
}

/**
 * Error thrown when Lua script execution fails.
 */
export class RateLimitScriptError extends RateLimitError {
  constructor(message: string, cause?: Error) {
    super(message, ErrorCode.RATE_LIMIT_SCRIPT_ERROR, undefined, cause);
  }
}
