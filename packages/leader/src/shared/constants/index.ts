/**
 * Injection tokens and defaults for the leader election plugin.
 */

/** Injection token for leader plugin options. */
export const LEADER_PLUGIN_OPTIONS = Symbol.for('LEADER_PLUGIN_OPTIONS');

/** Injection token for the leader service. */
export const LEADER_SERVICE = Symbol.for('LEADER_SERVICE');

/** Injection token for the leader store. */
export const LEADER_STORE = Symbol.for('LEADER_STORE');

/**
 * Plugin-specific Redis driver token.
 * Resolves to the named client specified in plugin options.
 */
export const LEADER_REDIS_DRIVER = Symbol.for('LEADER_REDIS_DRIVER');

/** The election group used when none is specified. */
export const DEFAULT_LEADER_GROUP = 'default';

/**
 * Upper bound for the lease TTL (10 years) — anything reaching PEXPIRE must
 * be a safe, sane integer.
 */
export const MAX_LEADER_TTL_MS = 10 * 365 * 24 * 60 * 60 * 1000;

/** Default configuration (single source of truth). */
export const DEFAULT_LEADER_CONFIG = {
  keyPrefix: 'leader:',
  ttlMs: 15_000,
  renewIntervalMs: 5_000,
  retryIntervalMs: 2_000,
  groups: [] as string[],
} as const;
