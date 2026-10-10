/**
 * Injection token for counters plugin options.
 */
export const COUNTERS_PLUGIN_OPTIONS = Symbol.for('COUNTERS_PLUGIN_OPTIONS');

/**
 * Injection token for the counter service.
 */
export const COUNTER_SERVICE = Symbol.for('COUNTER_SERVICE');

/**
 * Injection token for the counter store.
 */
export const COUNTER_STORE = Symbol.for('COUNTER_STORE');

/**
 * Plugin-specific Redis driver token.
 * Resolves to the named client specified in plugin options.
 */
export const COUNTERS_REDIS_DRIVER = Symbol.for('COUNTERS_REDIS_DRIVER');

/**
 * Default plugin configuration - the single source of defaults.
 */
export const DEFAULT_COUNTERS_CONFIG = {
  keyPrefix: '_ctr:',
} as const;
