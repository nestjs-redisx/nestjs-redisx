/**
 * L2 (Redis) cache store interface.
 */

import { SwrEntry } from '../../../shared/types';
import { CacheEntry } from '../../domain/value-objects/cache-entry.vo';

export interface IL2CacheStore {
  /**
   * Gets cache entry from L2 cache.
   *
   * @param key - Cache key
   * @returns CacheEntry or null if not found
   */
  get<T>(key: string): Promise<CacheEntry<T> | null>;

  /**
   * Sets cache entry in L2 cache.
   *
   * @param key - Cache key
   * @param entry - Cache entry to store
   * @param ttlSeconds - TTL in seconds (optional)
   */
  set<T>(key: string, entry: CacheEntry<T>, ttlSeconds?: number): Promise<void>;

  /**
   * Deletes value from L2 cache.
   *
   * @param key - Cache key
   * @returns true if deleted, false if not found
   */
  delete(key: string): Promise<boolean>;

  /**
   * Checks if key exists in L2 cache.
   *
   * @param key - Cache key
   * @returns true if exists
   */
  has(key: string): Promise<boolean>;

  /**
   * Clears all cache entries.
   * WARNING: This is a destructive operation.
   */
  clear(): Promise<void>;

  /**
   * Gets multiple cache entries from L2 cache.
   *
   * @param keys - Array of cache keys
   * @returns Map of key -> CacheEntry (null if not found)
   */
  getMany<T>(keys: string[]): Promise<Array<CacheEntry<T> | null>>;

  /**
   * Sets multiple cache entries in L2 cache.
   *
   * @param entries - Array of entries with key, entry, and optional ttl
   */
  setMany<T>(entries: Array<{ key: string; entry: CacheEntry<T>; ttl?: number }>): Promise<void>;

  /**
   * Gets TTL for a key.
   *
   * @param key - Cache key
   * @returns TTL in seconds, -1 if no TTL, -2 if key doesn't exist
   */
  ttl(key: string): Promise<number>;

  /**
   * Gets L2 cache statistics.
   */
  getStats(): Promise<{ hits: number; misses: number }>;

  /**
   * Gets SWR entry from L2 cache with metadata.
   *
   * @param key - Cache key
   * @returns SwrEntry with timestamps or null if not found
   */
  getSwr<T>(key: string): Promise<SwrEntry<T> | null>;

  /**
   * Sets SWR entry in L2 cache with metadata.
   *
   * @param key - Cache key
   * @param swrEntry - SWR entry with value and timestamps
   */
  setSwr<T>(key: string, swrEntry: SwrEntry<T>): Promise<void>;

  /**
   * Scans keys matching a pattern using Redis SCAN.
   *
   * @param pattern - Redis pattern (supports * and ?)
   * @param count - Hint for number of elements per SCAN iteration
   * @returns Scan result with matching keys and cursor
   */
  scan(pattern: string, count?: number): Promise<{ keys: string[]; cursor: string }>;
}
