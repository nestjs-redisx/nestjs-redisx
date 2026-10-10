import { LeaderLostReason } from '../../../shared/types';

/**
 * Leader service port.
 * Defines the contract for leader election operations.
 */
export interface ILeaderService {
  /**
   * This process's identity - the value stored in the election key while it
   * leads, and what `getLeaderId()` returns on other instances.
   */
  readonly instanceId: string;

  /**
   * Whether THIS instance currently leads the group. Synchronous local lease
   * view, fail-safe: true only while the last confirmed lease is unexpired.
   *
   * @param group - Election group (default `'default'`)
   *
   * @example
   * ```typescript
   * @Cron('0 * * * *')
   * async hourly() {
   *   if (!this.leader.isLeader()) return;
   *   await this.reports.build();
   * }
   * ```
   */
  isLeader(group?: string): boolean;

  /**
   * Read the current leader's instance id from Redis (works on any instance).
   *
   * @param group - Election group (default `'default'`)
   * @returns the leader's instanceId, or null when nobody holds the lease
   * @throws {LeaderStoreError} when the store call fails
   */
  getLeaderId(group?: string): Promise<string | null>;

  /**
   * Execute `fn` only when this instance leads the group.
   *
   * @returns the function result, or undefined when skipped
   *
   * @example
   * ```typescript
   * const report = await this.leader.runIfLeader(() => this.buildReport());
   * ```
   */
  runIfLeader<T>(fn: () => T | Promise<T>, group?: string): Promise<T | undefined>;

  /**
   * Voluntarily give up leadership: release the lease and abstain from
   * candidacy for one `ttlMs`, so another instance can take over (useful
   * before planned maintenance of this node). Emits `onLost(group,
   * 'stepdown')`.
   */
  stepDown(group?: string): Promise<void>;

  /**
   * Groups with running elections on this instance (monitoring aid).
   */
  getGroups(): string[];
}

/**
 * Re-exported for callback typing convenience.
 */
export type { LeaderLostReason };
