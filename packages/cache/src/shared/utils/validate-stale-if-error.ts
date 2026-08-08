import { CacheConfigError } from '../errors';
import { ICachePluginOptions } from '../types';

type StaleIfErrorOptions = NonNullable<ICachePluginOptions['staleIfError']>;

/**
 * Fail-fast validation for the stale-if-error configuration. Used by the
 * plugin at bootstrap (merged defaults) and by the service for per-call
 * overrides — invalid values throw instead of silently misbehaving
 * (e.g. a zero/negative window would delete entries instantly).
 */
export function validateStaleIfError<T extends { window?: number; defaultWindow?: number; shouldServe?: (error: Error) => boolean }>(options: T): T {
  const window = options.defaultWindow ?? options.window;

  if (window !== undefined && (typeof window !== 'number' || !Number.isFinite(window) || window <= 0)) {
    throw new CacheConfigError(`staleIfError window must be a finite number of seconds > 0, got ${String(window)}. ` + `For a "practically infinite" outage budget use an explicit large value (e.g. 2592000 for 30 days).`);
  }

  if (options.shouldServe !== undefined && typeof options.shouldServe !== 'function') {
    throw new CacheConfigError('staleIfError.shouldServe must be a function (error) => boolean');
  }

  return options;
}

export type { StaleIfErrorOptions };
