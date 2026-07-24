import { ICircuitBreakerConfig, ICircuitSnapshot } from '../../circuit-breaker/domain/circuit-breaker-state.interface';

/**
 * Circuit breaker plugin options.
 */
export interface ICircuitBreakerPluginOptions {
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
   * Key prefix in Redis.
   * @default 'cb:'
   */
  keyPrefix?: string;

  /**
   * Default failures within windowMs that trip CLOSED -> OPEN.
   * @default 5
   */
  failureThreshold?: number;

  /**
   * Default rolling window (ms) over which failures are counted in CLOSED.
   * @default 10000
   */
  windowMs?: number;

  /**
   * Default time (ms) the breaker stays OPEN before probes are allowed.
   * @default 30000
   */
  openDurationMs?: number;

  /**
   * Default max probe calls permitted while HALF_OPEN.
   * @default 1
   */
  halfOpenMaxCalls?: number;

  /**
   * Default successful probes required to close from HALF_OPEN.
   * @default 1
   */
  successThreshold?: number;

  /**
   * Error handling strategy for STATE STORE failures (e.g. Redis/Lua errors).
   * - fail-open: run the guarded call anyway (high availability)
   * - fail-closed: throw CircuitBreakerStoreError (strict enforcement)
   * @default 'fail-closed'
   */
  errorPolicy?: 'fail-open' | 'fail-closed';

  /**
   * Custom error factory used when the breaker rejects a call (OPEN).
   */
  errorFactory?: (key: string, snapshot: ICircuitSnapshot) => Error;
}

/**
 * Per-call configuration overrides (subset of the state-machine knobs).
 */
export interface ICircuitBreakerOptions {
  /** Override failureThreshold. */
  failureThreshold?: number;
  /** Override windowMs. */
  windowMs?: number;
  /** Override openDurationMs. */
  openDurationMs?: number;
  /** Override halfOpenMaxCalls. */
  halfOpenMaxCalls?: number;
  /** Override successThreshold. */
  successThreshold?: number;
}

/**
 * Options for a single {@link ICircuitBreakerService.execute} call.
 */
export interface ICircuitBreakerExecuteOptions<T = unknown> extends ICircuitBreakerOptions {
  /**
   * Called instead of throwing when the breaker rejects the call (OPEN).
   * Its result is returned from execute().
   */
  fallback?: () => T | Promise<T>;

  /**
   * Custom error factory used when the breaker rejects the call (OPEN).
   * Overrides the plugin-level errorFactory.
   */
  errorFactory?: (key: string, snapshot: ICircuitSnapshot) => Error;
}

/**
 * Decision returned by the store's canRequest.
 */
export interface ICircuitBreakerDecision {
  /** Whether the guarded call is permitted. */
  allowed: boolean;
  /** State snapshot after applying the request rule. */
  snapshot: ICircuitSnapshot;
}

// Type aliases for backward compatibility (non-I-prefixed)
export type CircuitBreakerPluginOptions = ICircuitBreakerPluginOptions;
export type CircuitBreakerOptions = ICircuitBreakerOptions;

// Re-export the resolved config for convenience (all knobs required).
export type { ICircuitBreakerConfig };
