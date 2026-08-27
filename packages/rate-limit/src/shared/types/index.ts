import { ExecutionContext } from '@nestjs/common';

/**
 * Key extractor function type.
 * Extracts rate limit key from execution context.
 */
export type KeyExtractor = (context: ExecutionContext) => string | Promise<string>;

/**
 * Rate limit store backend.
 * - `redis`: distributed counters shared by all application instances (exact).
 * - `memory`: per-instance in-process counters (zero Redis round-trip; each
 *   node enforces its own limit, so the effective global limit is roughly
 *   per-node limit x number of nodes).
 */
export type RateLimitStoreType = 'redis' | 'memory';

/**
 * Sizing options for the in-memory store.
 * The memory store has no Redis EXPIRE to bound it, so it caps the number of
 * tracked keys and periodically sweeps expired entries.
 */
export interface IRateLimitMemoryOptions {
  /**
   * Maximum number of tracked keys. When exceeded, the oldest entries are
   * evicted (approximate FIFO). Protects against unbounded key spray
   * (e.g. random IPs).
   * @default 100000
   */
  maxKeys?: number;

  /**
   * Interval in milliseconds between sweeps of expired entries.
   * @default 30000
   */
  sweepIntervalMs?: number;
}

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
   * Default store backend for all routes.
   *
   * `'redis'` (default) keeps limits distributed and exact across all
   * application instances. `'memory'` counts per instance in process memory —
   * no Redis round-trip on the request path, at the cost of approximate
   * global limits (each node enforces its own counter). Routes can override
   * per check via `@RateLimit({ store })` / `check(key, { store })`.
   *
   * Keep auth-sensitive routes (login, OTP, password reset) on `'redis'`:
   * a distributed brute force divides across nodes, so a per-node threshold
   * is effectively multiplied by the node count.
   * @default 'redis'
   */
  store?: RateLimitStoreType;

  /**
   * Sizing options for the in-memory store (used by `store: 'memory'`).
   */
  memory?: IRateLimitMemoryOptions;

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
   * - fail-closed: Reject request on error (strict enforcement) — the store
   *   error surfaces as `RateLimitScriptError`, which the built-in filter maps
   *   to `503 Service Unavailable` (not an uncaught 500).
   * @default 'fail-closed'
   */
  errorPolicy?: 'fail-open' | 'fail-closed';

  /**
   * Trust proxy-forwarded client IP headers (`X-Forwarded-For`, `X-Real-IP`)
   * when the key is derived from the client IP.
   *
   * **Default `false` (secure).** With `false`, the IP is taken from the
   * framework (`request.ip`), which is un-spoofable: if your app runs behind a
   * proxy, configure the framework's own trust setting (Express `trust proxy`
   * / Fastify `trustProxy`) and `request.ip` becomes the real client IP.
   *
   * Set `true` ONLY when a trusted proxy in front of you overwrites
   * `X-Forwarded-For`; otherwise any client can spoof the header and mint a
   * fresh rate-limit bucket per request (bypassing login/password-reset
   * throttling).
   * @default false
   */
  trustProxy?: boolean;

  /**
   * Register the built-in global exception filter (`APP_FILTER`) that maps
   * rate-limit errors to HTTP responses (429 for exceeded, 503 for store
   * failure). Set `false` to handle `RateLimitError` with your own filter and
   * response envelope.
   * @default true
   */
  registerExceptionFilter?: boolean;

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
   * Store backend for this check. Overrides the plugin-level `store` default
   * in either direction (`redis` <-> `memory`).
   */
  store?: RateLimitStoreType;

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
 * Options for {@link IRateLimitService.reset}.
 */
export interface IRateLimitResetOptions {
  /**
   * Store to reset. When omitted, BOTH stores are swept (the service does not
   * know which store a key was counted in). Note: resetting the memory store
   * only affects the instance that handles the call.
   */
  store?: RateLimitStoreType;
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
