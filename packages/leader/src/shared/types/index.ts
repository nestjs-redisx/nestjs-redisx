/**
 * Why leadership was lost.
 * - `expired`: the lease could not be renewed (rejected or store error).
 * - `stepdown`: this instance voluntarily stepped down.
 * - `shutdown`: the application is shutting down (lease released).
 */
export type LeaderLostReason = 'expired' | 'stepdown' | 'shutdown';

/**
 * Leader election plugin options.
 */
export interface ILeaderPluginOptions {
  /**
   * Named Redis client to use.
   * @default 'default'
   */
  client?: string;

  /**
   * Key prefix for election keys (`<keyPrefix><group>`).
   * @default 'leader:'
   */
  keyPrefix?: string;

  /**
   * Leadership lease TTL in milliseconds. A crashed leader is replaced within
   * roughly `ttlMs + retryIntervalMs`; a gracefully stopped one immediately.
   * @default 15000
   */
  ttlMs?: number;

  /**
   * Heartbeat interval while leader, in milliseconds.
   * Must be strictly less than `ttlMs`.
   * @default 5000
   */
  renewIntervalMs?: number;

  /**
   * Acquire retry interval while follower, in milliseconds.
   * @default 2000
   */
  retryIntervalMs?: number;

  /**
   * Extra election groups to start at bootstrap. The `'default'` group always
   * runs, and groups referenced by `@LeaderOnly({ group })` register
   * themselves at decoration time.
   */
  groups?: string[];

  /**
   * Stable identity of this instance, stored as the election key's value.
   * @default `${hostname}-${pid}-${random}`
   */
  instanceId?: string;

  /**
   * Fired when this instance becomes leader of a group (fire-and-forget:
   * errors are logged, never break the election loop).
   */
  onElected?: (group: string) => void | Promise<void>;

  /**
   * Fired when this instance loses leadership of a group (fire-and-forget).
   */
  onLost?: (group: string, reason: LeaderLostReason) => void | Promise<void>;
}
