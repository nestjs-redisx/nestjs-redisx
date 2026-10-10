/**
 * Configuration options for the Semaphore plugin.
 * @public
 */
export interface ISemaphorePluginOptions {
  /**
   * Named Redis client to use.
   * @default 'default'
   */
  client?: string;

  /**
   * Key prefix for semaphore keys.
   * @default '_sem:'
   */
  keyPrefix?: string;

  /**
   * Default permit TTL in milliseconds. A permit that is neither released
   * nor renewed frees its seat after this long (crash safety).
   * @default 30000
   */
  defaultTtl?: number;

  /**
   * Maximum permit TTL in milliseconds. Caps both the configured default and
   * per-call `ttl` values.
   * @default 300000
   */
  maxTtl?: number;

  /**
   * Retry configuration for permit acquisition.
   */
  retry?: {
    /**
     * Maximum number of retries after the initial attempt.
     * @default 3
     */
    maxRetries?: number;

    /**
     * Initial delay between retries in milliseconds.
     * @default 100
     */
    initialDelay?: number;

    /**
     * Maximum delay between retries in milliseconds.
     * @default 3000
     */
    maxDelay?: number;

    /**
     * Multiplier for exponential backoff.
     * @default 2
     */
    multiplier?: number;
  };

  /**
   * Auto-renewal configuration for held permits.
   */
  autoRenew?: {
    /**
     * Enable auto-renewal.
     * @default true
     */
    enabled?: boolean;

    /**
     * Fraction of TTL to use as the renewal interval.
     * @default 0.5
     */
    intervalFraction?: number;
  };
}

/**
 * Options for a single permit acquisition.
 */
export interface ISemaphoreOptions {
  /**
   * Permit TTL in milliseconds (capped at the plugin `maxTtl`).
   */
  ttl?: number;

  /**
   * Maximum time to wait for a permit in milliseconds. Bounds the total
   * retry budget; without it the retry config alone decides when to give up.
   */
  waitTimeout?: number;

  /**
   * Enable auto-renewal for this permit.
   */
  autoRenew?: boolean;

  /**
   * Retry configuration for this specific acquisition.
   */
  retry?: {
    /**
     * Maximum number of retries.
     */
    maxRetries?: number;

    /**
     * Initial delay between retries in milliseconds.
     */
    initialDelay?: number;
  };
}

/**
 * Alias for plugin options (for consistency with plugin naming).
 * @public
 */
export type SemaphorePluginOptions = ISemaphorePluginOptions;
