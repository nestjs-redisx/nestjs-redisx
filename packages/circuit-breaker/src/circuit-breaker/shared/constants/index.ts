/**
 * Injection tokens for the circuit breaker plugin.
 *
 * These are declared now for the skeleton; they will be wired into the
 * service/store layer in a later step.
 */

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
