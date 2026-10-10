/**
 * Injection token for dedup plugin options.
 */
export const DEDUP_PLUGIN_OPTIONS = Symbol.for('DEDUP_PLUGIN_OPTIONS');

/**
 * Injection token for the dedup service.
 */
export const DEDUP_SERVICE = Symbol.for('DEDUP_SERVICE');

/**
 * Injection token for the dedup store.
 */
export const DEDUP_STORE = Symbol.for('DEDUP_STORE');

/**
 * Plugin-specific Redis driver token.
 * Resolves to the named client specified in plugin options.
 */
export const DEDUP_REDIS_DRIVER = Symbol.for('DEDUP_REDIS_DRIVER');

/**
 * Default plugin configuration — the single source of defaults.
 */
export const DEFAULT_DEDUP_CONFIG = {
  keyPrefix: '_dedup:',
  defaultWindow: 60_000,
  errorPolicy: 'fail-open',
} as const;
