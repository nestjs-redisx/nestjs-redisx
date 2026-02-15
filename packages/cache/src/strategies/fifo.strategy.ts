/**
 * First In First Out (FIFO) eviction strategy.
 *
 * Evicts the oldest inserted item when cache is full.
 * Does not consider access patterns - only insertion order matters.
 *
 * @example
 * ```typescript
 * const strategy = new FifoStrategy<string>();
 *
 * strategy.recordInsert('key1');
 * strategy.recordInsert('key2');
 * strategy.recordAccess('key1'); // Access doesn't affect order in FIFO
 *
 * const victim = strategy.selectVictim(); // Returns 'key1' (first inserted)
 * ```
 */

import { IEvictionStrategy } from './eviction-strategy.interface';

export class FifoStrategy<K = string> implements IEvictionStrategy<K> {
  /**
   * Queue maintaining keys in insertion order.
   * First element is oldest (next to evict).
   */
  private readonly queue: K[];

  /**
   * Set for O(1) existence checks
   */
  private readonly keySet: Set<K>;

  constructor() {
    this.queue = [];
    this.keySet = new Set();
  }

  /**
   * Records access to a key.
   * In FIFO, access doesn't affect eviction order, so this is a no-op.
   *
   * @param _key - Key that was accessed
   */
  recordAccess(_key: K): void {
    // FIFO doesn't care about access - only insertion order matters
    // No-op
  }

  /**
   * Records insertion of a new key.
   *
   * @param key - Key that was inserted
   */
  recordInsert(key: K): void {
    // Only add if not already present
    if (!this.keySet.has(key)) {
      this.queue.push(key);
      this.keySet.add(key);
    }
  }

  /**
   * Records deletion of a key.
   *
   * @param key - Key that was deleted
   */
  recordDelete(key: K): void {
    if (this.keySet.has(key)) {
      // Remove from queue - O(n) operation but rare
      const index = this.queue.indexOf(key);
      if (index !== -1) {
        this.queue.splice(index, 1);
      }
      this.keySet.delete(key);
    }
  }

  /**
   * Selects the oldest inserted key for eviction.
   *
   * @returns Oldest key (first in queue), or undefined if empty
   */
  selectVictim(): K | undefined {
    return this.queue[0];
  }

  /**
   * Clears all tracking data.
   */
  clear(): void {
    this.queue.length = 0;
    this.keySet.clear();
  }

  /**
   * Gets current number of tracked keys.
   *
   * @returns Number of keys
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Gets all keys in FIFO order (oldest to newest).
   *
   * @returns Array of keys in insertion order
   */
  getKeys(): K[] {
    return [...this.queue];
  }

  /**
   * Gets keys that should be evicted to reach target size.
   *
   * @param targetSize - Desired size after eviction
   * @returns Array of keys to evict (oldest first)
   */
  getVictims(targetSize: number): K[] {
    const currentSize = this.queue.length;
    if (currentSize <= targetSize) {
      return [];
    }

    const numToEvict = currentSize - targetSize;
    return this.queue.slice(0, numToEvict);
  }

  /**
   * Checks if a key is tracked.
   *
   * @param key - Key to check
   * @returns True if key is tracked
   */
  has(key: K): boolean {
    return this.keySet.has(key);
  }
}
