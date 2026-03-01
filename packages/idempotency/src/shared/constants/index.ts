/**
 * Injection tokens for idempotency plugin.
 */
export const IDEMPOTENCY_PLUGIN_OPTIONS = Symbol.for('IDEMPOTENCY_PLUGIN_OPTIONS');
export const IDEMPOTENCY_SERVICE = Symbol.for('IDEMPOTENCY_SERVICE');
export const IDEMPOTENCY_STORE = Symbol.for('IDEMPOTENCY_STORE');

/**
 * Plugin-specific Redis driver token.
 * Resolves to the named client specified in plugin options.
 */
export const IDEMPOTENCY_REDIS_DRIVER = Symbol.for('IDEMPOTENCY_REDIS_DRIVER');
