/**
 * Least Frequently Used (LFU) eviction strategy.
 *
 * Evicts the least frequently accessed item when cache is full.
 * Tracks access frequency for each key, with insertion order as tiebreaker.
 *
 * @example
 * ```typescript
 * const strategy = new LfuStrategy<string>();
 *
 * strategy.recordInsert('key1');
 * strategy.recordInsert('key2');
 * strategy.recordAccess('key1'); // key1 frequency = 2
 * strategy.recordAccess('key1'); // key1 frequency = 3
 *
 * const victim = strategy.selectVictim(); // Returns 'key2' (frequency = 1)
 * ```
 */

import { IEvictionStrategy } from './eviction-strategy.interface';

interface ILfuEntry<K> {
  key: K;
  frequency: number;
  insertOrder: number;
}

export class LfuStrategy<K = string> implements IEvictionStrategy<K> {
  private readonly entries: Map<K, ILfuEntry<K>>;
  private insertCounter: number;

  constructor() {
    this.entries = new Map();
    this.insertCounter = 0;
  }

  /**
   * Records access to a key, incrementing its frequency counter.
   *
   * @param key - Key that was accessed
   */
  recordAccess(key: K): void {
    const entry = this.entries.get(key);
    if (entry) {
      entry.frequency++;
    }
  }

  /**
   * Records insertion of a new key with initial frequency of 1.
   *
   * @param key - Key that was inserted
   */
  recordInsert(key: K): void {
    if (!this.entries.has(key)) {
      this.insertCounter++;
      this.entries.set(key, {
        key,
        frequency: 1,
        insertOrder: this.insertCounter,
      });
    }
  }

  /**
   * Records deletion of a key.
   *
   * @param key - Key that was deleted
   */
  recordDelete(key: K): void {
    this.entries.delete(key);
  }

  /**
   * Selects the least frequently used key for eviction.
   * When frequencies are equal, the oldest inserted key is selected.
   *
   * @returns Least frequently used key, or undefined if empty
   */
  selectVictim(): K | undefined {
    if (this.entries.size === 0) {
      return undefined;
    }

    let victim: ILfuEntry<K> | undefined;

    for (const entry of this.entries.values()) {
      if (!victim || entry.frequency < victim.frequency || (entry.frequency === victim.frequency && entry.insertOrder < victim.insertOrder)) {
        victim = entry;
      }
    }

    return victim?.key;
  }

  /**
   * Clears all tracking data.
   */
  clear(): void {
    this.entries.clear();
    this.insertCounter = 0;
  }

  /**
   * Gets current number of tracked keys.
   *
   * @returns Number of keys
   */
  size(): number {
    return this.entries.size;
  }

  /**
   * Gets all keys sorted by frequency (lowest first), then by insertion order.
   *
   * @returns Array of keys sorted by eviction priority
   */
  getKeys(): K[] {
    return Array.from(this.entries.values())
      .sort((a, b) => a.frequency - b.frequency || a.insertOrder - b.insertOrder)
      .map((entry) => entry.key);
  }

  /**
   * Gets keys that should be evicted to reach target size.
   *
   * @param targetSize - Desired size after eviction
   * @returns Array of keys to evict
   */
  getVictims(targetSize: number): K[] {
    const currentSize = this.entries.size;
    if (currentSize <= targetSize) {
      return [];
    }

    const numToEvict = currentSize - targetSize;
    const sortedKeys = this.getKeys();
    return sortedKeys.slice(0, numToEvict);
  }

  /**
   * Checks if a key is tracked.
   *
   * @param key - Key to check
   * @returns True if key is tracked
   */
  has(key: K): boolean {
    return this.entries.has(key);
  }

  /**
   * Gets the frequency count for a key.
   *
   * @param key - Key to check
   * @returns Frequency count, or 0 if key not tracked
   */
  getFrequency(key: K): number {
    return this.entries.get(key)?.frequency ?? 0;
  }
}
