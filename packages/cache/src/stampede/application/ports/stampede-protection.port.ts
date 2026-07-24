/**
 * Stampede protection service interface.
 */

import { IStampedeResult, IStampedeStats } from '../../../shared/types';

export interface IStampedeProtection {
  /**
   * Executes loader with stampede protection.
   *
   * Layer 1 (local singleflight): only one concurrent execution per key within
   * the same process; concurrent callers coalesce onto the in-flight promise.
   * The flight is removed synchronously on completion — a finished flight is
   * NEVER served to later calls (that would return stale, pre-invalidation
   * values).
   *
   * Layer 2 (distributed lock): when another instance holds the lock and a
   * `recheck` callback is provided, this instance waits (bounded by
   * waitTimeout) for the lock to clear and rechecks the cache instead of
   * duplicating the load. If coordination falls through (leader failed, lock
   * expired, wait timed out, or no `recheck` given) the loader runs locally.
   *
   * @param key - Unique key for the operation
   * @param loader - Function to execute (must write the value to the cache
   *                 itself so the write is covered by the distributed lock)
   * @param recheck - Reads the freshly cached value after another instance's
   *                  lock cleared; return null to fall back to the loader
   * @returns Result with cached/waited flags
   */
  protect<T>(key: string, loader: () => Promise<T>, recheck?: () => Promise<T | null>): Promise<IStampedeResult<T>>;

  /**
   * Cancels an in-flight request for a key.
   *
   * @param key - Key to cancel
   */
  clearKey(key: string): Promise<void>;

  /**
   * Cancels all in-flight requests.
   */
  clearAll(): Promise<void>;

  /**
   * Gets stampede protection statistics.
   *
   * @returns Stats with active flights, waiters, and prevented count
   */
  getStats(): IStampedeStats;
}
