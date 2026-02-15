/**
 * Stale-While-Revalidate manager interface.
 */

import { SwrEntry } from '../../../shared/types';

export interface ISwrManager {
  /**
   * Gets value from SWR cache.
   * Returns value with staleness flag.
   *
   * @param key - Cache key
   * @returns SWR entry or null if not found
   */
  get<T>(key: string): Promise<SwrEntry<T> | null>;

  /**
   * Sets value in SWR cache with metadata.
   *
   * @param key - Cache key
   * @param value - Value to cache
   * @param staleTimeSeconds - Time after which value is stale
   */
  set<T>(key: string, value: T, staleTimeSeconds: number): Promise<void>;

  /**
   * Deletes SWR entry.
   *
   * @param key - Cache key
   */
  delete(key: string): Promise<void>;

  /**
   * Checks if an entry is stale (past staleAt timestamp).
   *
   * @param entry - SWR entry to check
   * @returns True if entry is stale
   */
  isStale<T>(entry: SwrEntry<T>): boolean;

  /**
   * Checks if an entry has expired completely (past expiresAt timestamp).
   *
   * @param entry - SWR entry to check
   * @returns True if entry has expired
   */
  isExpired<T>(entry: SwrEntry<T>): boolean;

  /**
   * Schedules background revalidation for a key.
   *
   * @param key - Cache key
   * @param loader - Function to load fresh value
   * @param onSuccess - Callback when revalidation succeeds
   * @param onError - Optional callback when revalidation fails
   */
  scheduleRevalidation<T>(key: string, loader: () => Promise<T>, onSuccess: (value: T) => Promise<void>, onError?: (error: Error) => void): Promise<void>;

  /**
   * Checks if revalidation can be started for a key.
   * Returns false if revalidation is already in progress.
   *
   * @param key - Cache key
   * @returns True if revalidation can proceed
   */
  shouldRevalidate(key: string): boolean;

  /**
   * Creates an SWR entry with metadata.
   *
   * @param value - Value to cache
   * @param freshTtl - Time in seconds until value becomes stale
   * @param staleTtl - Optional time in seconds for stale period (defaults to config)
   * @returns SWR entry with timestamps
   */
  createSwrEntry<T>(value: T, freshTtl: number, staleTtl?: number): SwrEntry<T>;

  /**
   * Gets SWR manager statistics.
   *
   * @returns Stats object with active revalidations count
   */
  getStats(): {
    activeRevalidations: number;
    enabled: boolean;
    staleTtl: number;
  };

  /**
   * Clears all pending revalidations.
   */
  clearRevalidations(): Promise<void>;
}
