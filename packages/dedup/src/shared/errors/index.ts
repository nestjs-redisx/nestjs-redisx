import { RedisXError, ErrorCode } from '@nestjs-redisx/core';

/**
 * Base error class for all deduplication errors.
 */
export class DedupError extends RedisXError {
  constructor(message: string, code: ErrorCode, cause?: Error, context?: Record<string, unknown>) {
    super(message, code, cause, context);
  }
}

/**
 * Error thrown on invalid plugin or per-call configuration (fail-fast,
 * never subject to the errorPolicy).
 */
export class InvalidDedupConfigError extends DedupError {
  constructor(message: string) {
    super(message, ErrorCode.DEDUP_CONFIG_INVALID);
  }
}

/**
 * Error thrown when a store operation fails — on the manual APIs always, and
 * on the gates (`dedupe`, `debounce`, `@Dedupe`) under errorPolicy
 * 'fail-closed'.
 */
export class DedupStoreError extends DedupError {
  constructor(
    public readonly dedupKey: string,
    cause?: Error,
  ) {
    super(`Dedup store operation failed for "${dedupKey}"`, ErrorCode.DEDUP_STORE_ERROR, cause, { dedupKey });
  }
}
