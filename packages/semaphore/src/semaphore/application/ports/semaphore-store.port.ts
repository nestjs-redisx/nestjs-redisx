/**
 * Semaphore store interface for low-level Redis operations.
 *
 * A semaphore is a sorted set keyed by permit id with the permit expiry as
 * the score. Every operation is atomic (Lua): expired permits are swept
 * inside the acquire path, so crashed holders free their seats after their
 * TTL without any background process.
 *
 * Time is injected (`nowMs`) — the store never reads a clock, keeping the
 * scripts deterministic and the domain testable.
 */
export interface ISemaphoreStore {
  /**
   * Attempts to acquire a permit atomically.
   *
   * Sweeps expired permits, then adds the permit only when fewer than
   * `capacity` live permits remain.
   *
   * @param key - Full semaphore key in Redis
   * @param permitId - Unique permit id
   * @param capacity - Maximum number of concurrent permits
   * @param ttlMs - Permit TTL in milliseconds
   * @param nowMs - Current time (ms epoch)
   * @returns True if the permit was acquired, false if the semaphore is full
   */
  acquire(key: string, permitId: string, capacity: number, ttlMs: number, nowMs: number): Promise<boolean>;

  /**
   * Releases a permit (idempotent).
   *
   * @param key - Full semaphore key in Redis
   * @param permitId - Permit id to remove
   * @returns True if the permit was held and removed
   */
  release(key: string, permitId: string): Promise<boolean>;

  /**
   * Extends a permit's TTL if it is still held (unexpired).
   *
   * @param key - Full semaphore key in Redis
   * @param permitId - Permit id to extend
   * @param ttlMs - New TTL in milliseconds (from now)
   * @param nowMs - Current time (ms epoch)
   * @returns True if extended, false if the permit expired or was released
   */
  extend(key: string, permitId: string, ttlMs: number, nowMs: number): Promise<boolean>;

  /**
   * Checks whether a permit is currently held (present and unexpired).
   *
   * @param key - Full semaphore key in Redis
   * @param permitId - Permit id to check
   * @param nowMs - Current time (ms epoch)
   * @returns True if the permit is live
   */
  isHeld(key: string, permitId: string, nowMs: number): Promise<boolean>;

  /**
   * Counts currently held (unexpired) permits.
   *
   * @param key - Full semaphore key in Redis
   * @param nowMs - Current time (ms epoch)
   * @returns Number of live permits
   */
  usedPermits(key: string, nowMs: number): Promise<number>;

  /**
   * Force-releases every permit on the semaphore (admin operation).
   *
   * @param key - Full semaphore key in Redis
   * @returns Number of permits that were held
   */
  forceReleaseAll(key: string): Promise<number>;
}
