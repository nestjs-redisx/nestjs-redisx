import { RedisXError, ErrorCode } from '@nestjs-redisx/core';

/**
 * Base error class for leader election errors.
 */
export class LeaderError extends RedisXError {
  constructor(message: string, code: ErrorCode, cause?: Error) {
    super(message, code, cause);
  }
}

/**
 * Error thrown when plugin or per-call configuration is invalid.
 * Always fail-fast; never swallowed by the election loop.
 */
export class InvalidLeaderConfigError extends LeaderError {
  constructor(message: string) {
    super(message, ErrorCode.LEADER_CONFIG_INVALID);
  }
}

/**
 * Error thrown when a Redis operation of the leader store fails.
 * Background election ticks catch it (leadership is simply not confirmed);
 * direct API calls like `getLeaderId()` propagate it.
 */
export class LeaderStoreError extends LeaderError {
  constructor(message: string, cause?: Error) {
    super(message, ErrorCode.LEADER_STORE_ERROR, cause);
  }
}
