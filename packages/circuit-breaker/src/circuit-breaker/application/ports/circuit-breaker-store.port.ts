import { ICircuitBreakerConfig, ICircuitSnapshot } from '../../domain/circuit-breaker-state.interface';
import { ICircuitBreakerDecision } from '../../shared/types';

/**
 * Circuit breaker state store port.
 * Defines the contract for the distributed CB state backend.
 * Implementation is in the infrastructure layer (RedisCircuitBreakerStoreAdapter).
 *
 * The store mirrors the {@link CircuitBreakerState} semantics one-to-one, but
 * atomically over Redis. The current time (`now`) is obtained by the adapter
 * (via Date.now()) and passed into the Lua scripts — never read inside Lua.
 */
export interface ICircuitBreakerStore {
  /**
   * Apply the "can a request proceed now?" rule and return the decision plus
   * the resulting snapshot. Mutating: commits OPEN -> HALF_OPEN when the
   * cooldown elapsed and consumes a half-open probe slot when granted.
   *
   * @param key - Fully-prefixed circuit key
   * @param config - Resolved circuit breaker config (all knobs present)
   */
  canRequest(key: string, config: ICircuitBreakerConfig): Promise<ICircuitBreakerDecision>;

  /**
   * Record a successful call and return the resulting snapshot.
   *
   * @param key - Fully-prefixed circuit key
   * @param config - Resolved circuit breaker config
   */
  recordSuccess(key: string, config: ICircuitBreakerConfig): Promise<ICircuitSnapshot>;

  /**
   * Record a failed call and return the resulting snapshot.
   *
   * @param key - Fully-prefixed circuit key
   * @param config - Resolved circuit breaker config
   */
  recordFailure(key: string, config: ICircuitBreakerConfig): Promise<ICircuitSnapshot>;

  /**
   * Read the committed state without mutating it (does not flip OPEN -> HALF_OPEN).
   *
   * @param key - Fully-prefixed circuit key
   * @param config - Resolved circuit breaker config
   */
  getState(key: string, config: ICircuitBreakerConfig): Promise<ICircuitSnapshot>;

  /**
   * Reset the circuit to CLOSED and clear all state.
   *
   * @param key - Fully-prefixed circuit key
   */
  reset(key: string): Promise<void>;
}
