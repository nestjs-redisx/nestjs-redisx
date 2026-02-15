/**
 * Eviction strategy interface for cache management.
 * Defines how items should be evicted when cache reaches capacity.
 */

export interface IEvictionStrategy<K = string, _V = unknown> {
  /**
   * Records access to a key (for LRU, etc.)
   *
   * @param key - Cache key that was accessed
   */
  recordAccess(key: K): void;

  /**
   * Records insertion of a new key
   *
   * @param key - Cache key that was inserted
   */
  recordInsert(key: K): void;

  /**
   * Records deletion of a key
   *
   * @param key - Cache key that was deleted
   */
  recordDelete(key: K): void;

  /**
   * Selects key to evict based on strategy
   *
   * @returns Key to evict, or undefined if no candidates
   */
  selectVictim(): K | undefined;

  /**
   * Clears all tracking data
   */
  clear(): void;

  /**
   * Gets current size of tracked keys
   */
  size(): number;
}
