/**
 * Least Recently Used (LRU) eviction strategy.
 *
 * Evicts the least recently accessed item when cache is full.
 * Uses a Map to maintain insertion order and updates order on access.
 *
 * @example
 * ```typescript
 * const strategy = new LruStrategy<string>();
 *
 * strategy.recordInsert('key1');
 * strategy.recordInsert('key2');
 * strategy.recordAccess('key1'); // key1 is now most recent
 *
 * const victim = strategy.selectVictim(); // Returns 'key2' (least recent)
 * ```
 */

import { IEvictionStrategy } from './eviction-strategy.interface';

export class LruStrategy<K = string> implements IEvictionStrategy<K> {
  /**
   * Map maintaining keys in LRU order.
   * JavaScript Map maintains insertion order, so we use delete+set to move to end.
   */
  private readonly keyOrder: Map<K, number>;

  /**
   * Timestamp counter for tracking access order
   */
  private timestamp: number;

  constructor() {
    this.keyOrder = new Map();
    this.timestamp = 0;
  }

  /**
   * Records access to a key, moving it to most recently used position.
   *
   * @param key - Key that was accessed
   */
  recordAccess(key: K): void {
    // Update timestamp for this key
    this.timestamp++;
    this.keyOrder.set(key, this.timestamp);
  }

  /**
   * Records insertion of a new key.
   *
   * @param key - Key that was inserted
   */
  recordInsert(key: K): void {
    this.timestamp++;
    this.keyOrder.set(key, this.timestamp);
  }

  /**
   * Records deletion of a key.
   *
   * @param key - Key that was deleted
   */
  recordDelete(key: K): void {
    this.keyOrder.delete(key);
  }

  /**
   * Selects the least recently used key for eviction.
   *
   * @returns Least recently used key, or undefined if empty
   */
  selectVictim(): K | undefined {
    if (this.keyOrder.size === 0) {
      return undefined;
    }

    // Find key with smallest timestamp (least recently used)
    let oldestKey: K | undefined;
    let oldestTimestamp = Infinity;

    for (const [key, timestamp] of this.keyOrder.entries()) {
      if (timestamp < oldestTimestamp) {
        oldestTimestamp = timestamp;
        oldestKey = key;
      }
    }

    return oldestKey;
  }

  /**
   * Clears all tracking data.
   */
  clear(): void {
    this.keyOrder.clear();
    this.timestamp = 0;
  }

  /**
   * Gets current number of tracked keys.
   *
   * @returns Number of keys
   */
  size(): number {
    return this.keyOrder.size;
  }

  /**
   * Gets all keys in LRU order (oldest to newest).
   *
   * @returns Array of keys sorted by access time
   */
  getKeys(): K[] {
    return Array.from(this.keyOrder.entries())
      .sort(([, a], [, b]) => a - b)
      .map(([key]) => key);
  }

  /**
   * Gets keys that should be evicted to reach target size.
   *
   * @param targetSize - Desired size after eviction
   * @returns Array of keys to evict
   */
  getVictims(targetSize: number): K[] {
    const currentSize = this.keyOrder.size;
    if (currentSize <= targetSize) {
      return [];
    }

    const numToEvict = currentSize - targetSize;
    const sortedKeys = this.getKeys();
    return sortedKeys.slice(0, numToEvict);
  }
}
