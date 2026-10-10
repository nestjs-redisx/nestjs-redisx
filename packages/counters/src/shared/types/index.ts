/**
 * Configuration options for the Counters plugin.
 * @public
 */
export interface ICountersPluginOptions {
  /**
   * Named Redis client to use.
   * @default 'default'
   */
  client?: string;

  /**
   * Key prefix for counter keys.
   * @default '_ctr:'
   */
  keyPrefix?: string;
}

/**
 * Options for a counter mutation.
 */
export interface ICounterOptions {
  /**
   * Window TTL in milliseconds, applied only when the mutation CREATES the
   * key (first write in the window) — the idiomatic daily/hourly counter:
   * later mutations never extend the window.
   */
  ttl?: number;
}

/**
 * Alias for plugin options (for consistency with plugin naming).
 * @public
 */
export type CountersPluginOptions = ICountersPluginOptions;
