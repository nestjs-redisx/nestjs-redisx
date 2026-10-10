/**
 * Configuration options for the Dedup plugin.
 * @public
 */
export interface IDedupPluginOptions {
  /**
   * Named Redis client to use.
   * @default 'default'
   */
  client?: string;

  /**
   * Key prefix for deduplication markers.
   * @default '_dedup:'
   */
  keyPrefix?: string;

  /**
   * Default deduplication window in milliseconds: how long after the first
   * occurrence repeats are considered duplicates.
   * @default 60000
   */
  defaultWindow?: number;

  /**
   * What the GATES (`dedupe`, `debounce`, `@Dedupe`) do when the store is
   * unreachable:
   * - 'fail-open' (default): run the function - duplicates become possible
   *   during the outage (at-least-once).
   * - 'fail-closed': throw DedupStoreError - work is skipped rather than
   *   possibly duplicated.
   *
   * Manual APIs (`isFirst`, `release`) are always strict and throw.
   * @default 'fail-open'
   */
  errorPolicy?: 'fail-open' | 'fail-closed';
}

/**
 * Options for a single deduplication check.
 */
export interface IDedupOptions {
  /**
   * Deduplication window in milliseconds.
   * Defaults to the plugin `defaultWindow`.
   */
  window?: number;
}

/**
 * Options for a debounce call.
 */
export interface IDebounceOptions {
  /**
   * Quiet window in milliseconds: the function runs once the key has not
   * been called for this long, on the instance that made the LAST call.
   * Defaults to the plugin `defaultWindow`.
   */
  window?: number;
}

/**
 * Alias for plugin options (for consistency with plugin naming).
 * @public
 */
export type DedupPluginOptions = IDedupPluginOptions;
