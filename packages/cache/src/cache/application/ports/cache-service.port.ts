/**
 * Main cache service interface (port).
 */

import { CacheSetOptions, CacheGetOrSetOptions, CacheStats } from '../../../shared/types';

/**
 * Main cache service interface.
 */
export interface ICacheService {
  /**
   * Gets value from cache (L1 -> L2).
   *
   * @param key - Cache key
   * @returns Cached value or null if not found
   */
  get<T>(key: string): Promise<T | null>;

  /**
   * Sets value in cache.
   *
   * @param key - Cache key
   * @param value - Value to cache
   * @param options - Cache options
   */
  set<T>(key: string, value: T, options?: CacheSetOptions): Promise<void>;

  /**
   * Deletes key from both caches.
   *
   * @param key - Cache key
   * @returns true if deleted, false if not found
   */
  delete(key: string): Promise<boolean>;

  /**
   * Checks if key exists in cache.
   *
   * @param key - Cache key
   * @returns true if exists, false otherwise
   */
  has(key: string): Promise<boolean>;

  /**
   * Gets value or loads and caches it.
   * Implements stampede protection.
   *
   * @param key - Cache key
   * @param loader - Function to load value if cache miss
   * @param options - Cache options
   * @returns Cached or loaded value
   */
  getOrSet<T>(key: string, loader: () => Promise<T>, options?: CacheGetOrSetOptions): Promise<T>;

  /**
   * Gets multiple values from cache.
   *
   * @param keys - Array of cache keys
   * @returns Array of values (null if not found)
   */
  getMany<T>(keys: string[]): Promise<Array<T | null>>;

  /**
   * Sets multiple values in cache.
   *
   * @param entries - Array of entries with key, value, and optional options
   */
  setMany<T>(entries: Array<{ key: string; value: T; ttl?: number; tags?: string[] }>): Promise<void>;

  /**
   * Deletes multiple keys from cache.
   *
   * @param keys - Array of cache keys
   * @returns Number of keys deleted
   */
  deleteMany(keys: string[]): Promise<number>;

  /**
   * Invalidates all keys with given tag.
   *
   * @param tag - Tag name
   * @returns Number of keys invalidated
   */
  invalidateTag(tag: string): Promise<number>;

  /**
   * Invalidates all keys with any of given tags.
   *
   * @param tags - Array of tag names
   * @returns Number of keys invalidated
   */
  invalidateTags(tags: string[]): Promise<number>;

  /**
   * Gets all keys associated with a tag.
   *
   * @param tag - Tag name
   * @returns Array of cache keys
   */
  getKeysByTag(tag: string): Promise<string[]>;

  /**
   * Gets TTL for a key in seconds.
   *
   * @param key - Cache key
   * @returns TTL in seconds, -1 if no TTL, -2 if key doesn't exist
   */
  ttl(key: string): Promise<number>;

  /**
   * Clears all caches (L1 + L2).
   */
  clear(): Promise<void>;

  /**
   * Gets cache statistics.
   *
   * @returns Cache stats
   */
  getStats(): Promise<CacheStats>;

  /**
   * Invalidates cache keys matching a pattern.
   * Uses Redis SCAN for safe iteration.
   *
   * @param pattern - Redis pattern (supports * and ?)
   * @returns Number of keys deleted
   */
  invalidateByPattern(pattern: string): Promise<number>;
}
