/**
 * Configuration options for the Locks plugin
 * @public
 */
export interface ILocksPluginOptions {
  /**
   * Named Redis client to use.
   * @default 'default'
   */
  client?: string;

  /**
   * Default TTL for locks in milliseconds
   * @default 30000
   */
  defaultTtl?: number;

  /**
   * Maximum TTL for locks in milliseconds
   * @default 300000
   */
  maxTtl?: number;

  /**
   * Key prefix for lock keys
   * @default '_lock:'
   */
  keyPrefix?: string;

  /**
   * Retry configuration for lock acquisition
   */
  retry?: {
    /**
     * Maximum number of retries
     * @default 3
     */
    maxRetries?: number;

    /**
     * Initial delay between retries in milliseconds
     * @default 100
     */
    initialDelay?: number;

    /**
     * Maximum delay between retries in milliseconds
     * @default 3000
     */
    maxDelay?: number;

    /**
     * Multiplier for exponential backoff
     * @default 2
     */
    multiplier?: number;
  };

  /**
   * Auto-renewal configuration
   */
  autoRenew?: {
    /**
     * Enable auto-renewal
     * @default true
     */
    enabled?: boolean;

    /**
     * Fraction of TTL to use as renewal interval
     * @default 0.5
     */
    intervalFraction?: number;
  };
}

/**
 * Options for lock acquisition
 */
export interface ILockOptions {
  /**
   * Lock TTL in milliseconds
   */
  ttl?: number;

  /**
   * Maximum time to wait for lock acquisition in milliseconds
   */
  waitTimeout?: number;

  /**
   * Enable auto-renewal for this lock
   */
  autoRenew?: boolean;

  /**
   * Retry configuration for this specific lock
   */
  retry?: {
    /**
     * Maximum number of retries
     */
    maxRetries?: number;

    /**
     * Initial delay between retries in milliseconds
     */
    initialDelay?: number;
  };
}

/**
 * Alias for plugin options (for consistency with plugin naming)
 * @public
 */
export type LocksPluginOptions = ILocksPluginOptions;
