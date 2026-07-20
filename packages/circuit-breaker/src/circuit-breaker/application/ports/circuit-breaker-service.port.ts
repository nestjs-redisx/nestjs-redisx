import { ICircuitSnapshot } from '../../domain/circuit-breaker-state.interface';
import { ICircuitBreakerExecuteOptions, ICircuitBreakerOptions } from '../../shared/types';

/**
 * Circuit breaker service port.
 * Defines the public contract for guarding calls with a distributed breaker.
 */
export interface ICircuitBreakerService {
  /**
   * Execute `fn` guarded by the circuit breaker for `key`.
   *
   * - If the breaker permits the call: runs `fn`, records success/failure, and
   *   returns/propagates its result/error.
   * - If the breaker rejects the call (OPEN / probe budget exhausted): returns
   *   `options.fallback()` if provided, otherwise throws the error from
   *   `options.errorFactory` / the plugin `errorFactory`, otherwise
   *   `CircuitBreakerOpenError`.
   *
   * Store failures are handled per the configured `errorPolicy`
   * (fail-open runs `fn` anyway; fail-closed throws `CircuitBreakerStoreError`).
   *
   * @param key - Logical circuit key (prefixed internally)
   * @param fn - The guarded operation
   * @param options - Per-call overrides, fallback, and error factory
   *
   * @throws {CircuitBreakerOpenError} When rejected and no fallback/errorFactory
   * @throws {CircuitBreakerStoreError} When the store fails under fail-closed
   *
   * @example
   * ```typescript
   * const user = await cb.execute('users-api', () => http.get('/users/1'), {
   *   fallback: () => cachedUser,
   * });
   * ```
   */
  execute<T>(key: string, fn: () => Promise<T>, options?: ICircuitBreakerExecuteOptions<T>): Promise<T>;

  /**
   * Manually record a successful call for `key`.
   *
   * @param key - Logical circuit key
   * @param options - Per-call config overrides
   * @returns Resulting state snapshot
   */
  recordSuccess(key: string, options?: ICircuitBreakerOptions): Promise<ICircuitSnapshot>;

  /**
   * Manually record a failed call for `key`.
   *
   * @param key - Logical circuit key
   * @param options - Per-call config overrides
   * @returns Resulting state snapshot
   */
  recordFailure(key: string, options?: ICircuitBreakerOptions): Promise<ICircuitSnapshot>;

  /**
   * Read the current committed state for `key` (non-mutating).
   *
   * @param key - Logical circuit key
   * @param options - Per-call config overrides
   * @returns Current state snapshot
   */
  getState(key: string, options?: ICircuitBreakerOptions): Promise<ICircuitSnapshot>;

  /**
   * Reset the circuit for `key` to CLOSED and clear all state.
   *
   * @param key - Logical circuit key
   */
  reset(key: string): Promise<void>;
}
