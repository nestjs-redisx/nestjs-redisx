/**
 * Injection token for semaphore plugin options.
 */
export const SEMAPHORE_PLUGIN_OPTIONS = Symbol.for('SEMAPHORE_PLUGIN_OPTIONS');

/**
 * Injection token for the semaphore service.
 */
export const SEMAPHORE_SERVICE = Symbol.for('SEMAPHORE_SERVICE');

/**
 * Injection token for the semaphore store.
 */
export const SEMAPHORE_STORE = Symbol.for('SEMAPHORE_STORE');

/**
 * Plugin-specific Redis driver token.
 * Resolves to the named client specified in plugin options.
 */
export const SEMAPHORE_REDIS_DRIVER = Symbol.for('SEMAPHORE_REDIS_DRIVER');

/**
 * Default plugin configuration — the single source of defaults
 * (plugin mergeDefaults and the service resolve against this).
 */
export const DEFAULT_SEMAPHORE_CONFIG = {
  keyPrefix: '_sem:',
  defaultTtl: 30_000,
  maxTtl: 300_000,
  retry: {
    maxRetries: 3,
    initialDelay: 100,
    maxDelay: 3_000,
    multiplier: 2,
  },
  autoRenew: {
    enabled: true,
    intervalFraction: 0.5,
  },
} as const;
