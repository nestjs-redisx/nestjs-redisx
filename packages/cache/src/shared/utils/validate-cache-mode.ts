/**
 * Fail-fast validation for the cache `mode` option.
 *
 * Runs at bootstrap (plugin registration, inside `mergeDefaults`) against the
 * RAW user options — so only values the developer set EXPLICITLY are checked,
 * and defaulted flags (e.g. `tags.enabled: true`) never trip a false positive.
 *
 * In `'l1-only'` mode the cache runs with NO Redis. Tags, SWR, stale-if-error
 * and singleflight still work (single-instance, in-memory), so those are NOT
 * rejected — only options that genuinely require a Redis connection or a
 * cross-instance broker are, and they fail here instead of silently
 * misbehaving in production.
 */

import { CacheConfigError } from '../errors';
import { ICachePluginOptions } from '../types';

const VALID_MODES = ['l1-l2', 'l1-only'] as const;

export function validateCacheMode(options: ICachePluginOptions): void {
  const { mode } = options;

  if (mode !== undefined && !(VALID_MODES as readonly string[]).includes(mode)) {
    throw new CacheConfigError(`mode must be one of ${VALID_MODES.map((m) => `"${m}"`).join(' | ')}, got ${JSON.stringify(mode)}`);
  }

  if (mode !== 'l1-only') {
    return;
  }

  if (options.client !== undefined) {
    throw new CacheConfigError(`mode "l1-only" runs without Redis, so the "client" option (Redis client "${options.client}") cannot be used — remove it, or use mode "l1-l2".`);
  }

  if (options.l1?.enabled === false) {
    throw new CacheConfigError('mode "l1-only" needs the in-memory cache — remove l1.enabled:false.');
  }

  if (options.l2?.enabled === false) {
    throw new CacheConfigError('mode "l1-only" already serves the L2 tier from memory — l2.enabled:false is redundant and contradictory; remove it.');
  }

  if (options.invalidation?.source === 'amqp') {
    throw new CacheConfigError('mode "l1-only" is single-instance and cannot reach an AMQP broker — use the default "internal" invalidation source, or switch to mode "l1-l2".');
  }
}
