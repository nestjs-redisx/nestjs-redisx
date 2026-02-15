/**
 * Stampede protection service interface.
 */

import { IStampedeResult, IStampedeStats } from '../../../shared/types';

export interface IStampedeProtection {
  /**
   * Executes loader with stampede protection.
   * Only one concurrent execution per key is allowed within the same process.
   * Uses distributed Redis lock for cross-process protection.
   *
   * @param key - Unique key for the operation
   * @param loader - Function to execute
   * @returns Result with cached/waited flags
   */
  protect<T>(key: string, loader: () => Promise<T>): Promise<IStampedeResult<T>>;

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
