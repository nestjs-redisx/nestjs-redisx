/**
 * L1 (in-memory) cache store interface.
 */

import { CacheEntry } from '../../domain/value-objects/cache-entry.vo';

export interface IL1CacheStore {
  /**
   * Gets value from L1 cache.
   *
   * @param key - Cache key
   * @returns CacheEntry or null if not found/expired
   */
  get<T>(key: string): Promise<CacheEntry<T> | null>;

  /**
   * Sets value in L1 cache.
   *
   * @param key - Cache key
   * @param entry - CacheEntry to store
   * @param ttl - TTL in milliseconds (optional, uses default if not provided)
   */
  set<T>(key: string, entry: CacheEntry<T>, ttl?: number): Promise<void>;

  /**
   * Deletes value from L1 cache.
   *
   * @param key - Cache key
   * @returns true if existed, false otherwise
   */
  delete(key: string): Promise<boolean>;

  /**
   * Checks if key exists in L1 cache.
   *
   * @param key - Cache key
   * @returns true if exists and not expired
   */
  has(key: string): Promise<boolean>;

  /**
   * Gets current size of L1 cache.
   *
   * @returns Number of items in cache
   */
  size(): Promise<number>;

  /**
   * Clears all items from L1 cache.
   */
  clear(): Promise<void>;

  /**
   * Gets L1 cache statistics.
   *
   * @returns Cache statistics (hits, misses, size)
   */
  getStats(): { hits: number; misses: number; size: number };
}
