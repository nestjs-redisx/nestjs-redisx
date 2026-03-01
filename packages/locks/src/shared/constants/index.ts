/**
 * Injection token for locks plugin options
 */
export const LOCKS_PLUGIN_OPTIONS = Symbol.for('LOCKS_PLUGIN_OPTIONS');

/**
 * Injection token for lock service
 */
export const LOCK_SERVICE = Symbol.for('LOCK_SERVICE');

/**
 * Injection token for lock store
 */
export const LOCK_STORE = Symbol.for('LOCK_STORE');

/**
 * Plugin-specific Redis driver token.
 * Resolves to the named client specified in plugin options.
 */
export const LOCK_REDIS_DRIVER = Symbol.for('LOCK_REDIS_DRIVER');
