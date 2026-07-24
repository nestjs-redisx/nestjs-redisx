/**
 * Injection tokens and default configuration for the circuit breaker plugin.
 */

import { ICircuitBreakerPluginOptions } from '../types';

/**
 * Injection token for circuit breaker plugin options.
 */
export const CIRCUIT_BREAKER_PLUGIN_OPTIONS = Symbol.for('CIRCUIT_BREAKER_PLUGIN_OPTIONS');

/**
 * Injection token for circuit breaker service.
 */
export const CIRCUIT_BREAKER_SERVICE = Symbol.for('CIRCUIT_BREAKER_SERVICE');

/**
 * Injection token for circuit breaker store.
 */
export const CIRCUIT_BREAKER_STORE = Symbol.for('CIRCUIT_BREAKER_STORE');

/**
 * Plugin-specific Redis driver token.
 * Resolves to the named client specified in plugin options.
 */
export const CIRCUIT_BREAKER_REDIS_DRIVER = Symbol.for('CIRCUIT_BREAKER_REDIS_DRIVER');

/**
 * Default circuit breaker configuration.
 * Single source of truth for the plugin's mergeDefaults and the service's
 * per-call config resolution.
 *
 * `probeTimeoutMs` is intentionally absent: its default is dynamic — it
 * follows the RESOLVED `openDurationMs` (a probe hanging longer than the
 * cooldown itself is presumed dead).
 */
export const DEFAULT_CIRCUIT_BREAKER_CONFIG: Required<Omit<ICircuitBreakerPluginOptions, 'isGlobal' | 'client' | 'errorFactory' | 'probeTimeoutMs'>> = {
  keyPrefix: 'cb:',
  failureThreshold: 5,
  windowMs: 10000,
  openDurationMs: 30000,
  halfOpenMaxCalls: 1,
  successThreshold: 1,
  errorPolicy: 'fail-closed',
};
