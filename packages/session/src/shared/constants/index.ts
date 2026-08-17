/**
 * Injection tokens and default configuration for the session plugin.
 */

import { ISessionPluginOptions } from '../types';

/**
 * Injection token for session plugin options.
 */
export const SESSION_PLUGIN_OPTIONS = Symbol.for('SESSION_PLUGIN_OPTIONS');

/**
 * Injection token for the session service (introspection, revocation, policies).
 */
export const SESSION_SERVICE = Symbol.for('SESSION_SERVICE');

/**
 * Injection token for the promise-based session store
 * (consumed by the express/fastify middleware adapters).
 */
export const SESSION_STORE = Symbol.for('SESSION_STORE');

/**
 * Plugin-specific Redis driver token.
 * Resolves to the named client specified in plugin options.
 */
export const SESSION_REDIS_DRIVER = Symbol.for('SESSION_REDIS_DRIVER');

/**
 * Upper bound for any session TTL / absolute lifetime (10 years).
 * Values beyond ~1e14 ms stringify in exponent notation inside Lua and abort
 * PEXPIRE mid-script AFTER the payload SET — Redis does not roll scripts
 * back, so the result would be a persisted, uncappable session key.
 */
export const MAX_SESSION_TTL_MS = 315_360_000_000;

/**
 * Default session configuration.
 * Single source of truth for the plugin's mergeDefaults.
 *
 * `userIdExtractor` is intentionally absent: its default
 * (`defaultUserIdExtractor`, the Passport convention) lives in the domain
 * layer and is applied by the plugin's mergeDefaults.
 */
export const DEFAULT_SESSION_CONFIG: Required<Pick<ISessionPluginOptions, 'keyPrefix' | 'defaultTtlMs' | 'maxSessionsPolicy'>> = {
  keyPrefix: 'sess:',
  defaultTtlMs: 86_400_000,
  maxSessionsPolicy: 'evict-oldest',
};
