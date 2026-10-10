/**
 * Counter store interface for low-level Redis operations.
 *
 * Counters are plain integer keys driven by INCRBY; the window variant and
 * the read-and-reset are atomic Lua scripts.
 */
export interface ICounterStore {
  /**
   * Adds a signed amount to the counter, creating it at 0 first.
   *
   * @param key - Full counter key in Redis
   * @param by - Signed amount
   * @param ttlMs - Optional window TTL applied only when this mutation
   *   CREATES the key (never extended afterwards)
   * @returns The new value
   */
  incrementBy(key: string, by: number, ttlMs?: number): Promise<number>;

  /**
   * Reads the current value.
   *
   * @param key - Full counter key in Redis
   * @returns The value, or null when the key does not exist
   */
  get(key: string): Promise<number | null>;

  /**
   * Sets the counter to an absolute value.
   *
   * @param key - Full counter key in Redis
   * @param value - Absolute value
   * @param ttlMs - Optional TTL for the key
   */
  set(key: string, value: number, ttlMs?: number): Promise<void>;

  /**
   * Deletes the counter.
   *
   * @param key - Full counter key in Redis
   * @returns True when a counter existed
   */
  reset(key: string): Promise<boolean>;

  /**
   * Atomically reads and deletes the counter.
   *
   * @param key - Full counter key in Redis
   * @returns The value before deletion (0 when absent)
   */
  getAndReset(key: string): Promise<number>;
}
