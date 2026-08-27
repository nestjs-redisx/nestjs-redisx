/**
 * Injection tokens for rate limit plugin.
 */

/**
 * Injection token for rate limit plugin options.
 */
export const RATE_LIMIT_PLUGIN_OPTIONS = Symbol.for('RATE_LIMIT_PLUGIN_OPTIONS');

/**
 * Injection token for rate limit service.
 */
export const RATE_LIMIT_SERVICE = Symbol.for('RATE_LIMIT_SERVICE');

/**
 * Injection token for the Redis-backed rate limit store.
 * Kept as the primary store token for backward compatibility.
 */
export const RATE_LIMIT_STORE = Symbol.for('RATE_LIMIT_STORE');

/**
 * Injection token for the in-memory (per-instance) rate limit store.
 * Registered alongside the Redis store; the service picks per check based on
 * the `store` option.
 */
export const RATE_LIMIT_MEMORY_STORE = Symbol.for('RATE_LIMIT_MEMORY_STORE');

/**
 * Plugin-specific Redis driver token.
 * Resolves to the named client specified in plugin options.
 */
export const RATE_LIMIT_REDIS_DRIVER = Symbol.for('RATE_LIMIT_REDIS_DRIVER');
