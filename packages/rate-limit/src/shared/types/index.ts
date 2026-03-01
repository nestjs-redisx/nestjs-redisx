import { ExecutionContext } from '@nestjs/common';

/**
 * Key extractor function type.
 * Extracts rate limit key from execution context.
 */
export type KeyExtractor = (context: ExecutionContext) => string | Promise<string>;

/**
 * Rate limit plugin options.
 */
export interface IRateLimitPluginOptions {
  /**
   * Make the module global.
   * @default false
   */
  isGlobal?: boolean;

  /**
   * Named Redis client to use.
   * @default 'default'
   */
  client?: string;

  /**
   * Default algorithm.
   * @default 'sliding-window'
   */
  defaultAlgorithm?: 'fixed-window' | 'sliding-window' | 'token-bucket';

  /**
   * Default number of requests allowed.
   * @default 100
   */
  defaultPoints?: number;

  /**
   * Default window duration in seconds.
   * @default 60
   */
  defaultDuration?: number;

  /**
   * Key prefix in Redis.
   * @default 'rl:'
   */
  keyPrefix?: string;

  /**
   * Default key extractor.
   * @default 'ip'
   */
  defaultKeyExtractor?: 'ip' | 'user' | 'apiKey' | KeyExtractor;

  /**
   * Include rate limit headers in response.
   * @default true
   */
  includeHeaders?: boolean;

  /**
   * Header names configuration.
   */
  headers?: {
    /** @default 'X-RateLimit-Limit' */
    limit?: string;
    /** @default 'X-RateLimit-Remaining' */
    remaining?: string;
    /** @default 'X-RateLimit-Reset' */
    reset?: string;
    /** @default 'Retry-After' */
    retryAfter?: string;
  };

  /**
   * Error handling strategy.
   * - fail-open: Allow request on error (high availability)
   * - fail-closed: Reject request on error (strict enforcement)
   * @default 'fail-closed'
   */
  errorPolicy?: 'fail-open' | 'fail-closed';

  /**
   * Skip rate limiting for certain conditions.
   */
  skip?: (context: ExecutionContext) => boolean | Promise<boolean>;

  /**
   * Custom error factory.
   */
  errorFactory?: (result: IRateLimitResult) => Error;
}

/**
 * Rate limit configuration for specific request.
 */
export interface IRateLimitConfig {
  /**
   * Algorithm to use.
   */
  algorithm?: 'fixed-window' | 'sliding-window' | 'token-bucket';

  /**
   * Max requests (fixed/sliding window) or capacity (token bucket).
   */
  points?: number;

  /**
   * Window duration in seconds.
   */
  duration?: number;

  /**
   * Bucket capacity for token bucket algorithm.
   */
  capacity?: number;

  /**
   * Tokens per second for token bucket algorithm.
   */
  refillRate?: number;
}

/**
 * Rate limit result returned by service.
 */
export interface IRateLimitResult {
  /**
   * Whether the request is allowed.
   */
  allowed: boolean;

  /**
   * Maximum number of requests allowed.
   */
  limit: number;

  /**
   * Number of requests remaining in window.
   */
  remaining: number;

  /**
   * Unix timestamp when the window resets.
   */
  reset: number;

  /**
   * Seconds until retry (only set when allowed = false).
   */
  retryAfter?: number;

  /**
   * Current count or tokens.
   */
  current: number;
}

/**
 * Rate limit state (for monitoring).
 */
export interface IRateLimitState {
  /**
   * Current count or tokens.
   */
  current: number;

  /**
   * Maximum allowed.
   */
  limit: number;

  /**
   * Remaining requests/tokens.
   */
  remaining: number;

  /**
   * Reset timestamp.
   */
  resetAt: Date;
}

// Type aliases for backward compatibility (non-I-prefixed)
export type RateLimitConfig = IRateLimitConfig;
export type RateLimitResult = IRateLimitResult;
export type RateLimitState = IRateLimitState;
