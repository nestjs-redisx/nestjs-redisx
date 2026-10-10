/**
 * Semaphore store interface for low-level Redis operations.
 *
 * A semaphore is a sorted set keyed by permit id with the permit expiry as
 * the score. Every operation is atomic (Lua): expired permits are swept
 * inside the acquire path, so crashed holders free their seats after their
 * TTL without any background process.
 *
 * TIME IS OWNED BY THE STORE: every expiry decision uses the Redis server
 * clock (fetched via TIME and cached as a local offset), never the calling
 * instance's clock — a replica with a skewed clock must not be able to
 * sweep other instances' live permits or misjudge its own.
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
   * @returns True if the permit was acquired, false if the semaphore is full
   */
  acquire(key: string, permitId: string, capacity: number, ttlMs: number): Promise<boolean>;

  /**
   * Releases a permit. The member is removed either way; "was held" is
   * reported only when the permit was still LIVE (an expired seat was not
   * protected — the caller must hear about it).
   *
   * @param key - Full semaphore key in Redis
   * @param permitId - Permit id to remove
   * @returns True if the permit was live and removed
   */
  release(key: string, permitId: string): Promise<boolean>;

  /**
   * Extends a permit's TTL if it is still held (unexpired).
   *
   * @param key - Full semaphore key in Redis
   * @param permitId - Permit id to extend
   * @param ttlMs - New TTL in milliseconds (from now)
   * @returns True if extended, false if the permit expired or was released
   */
  extend(key: string, permitId: string, ttlMs: number): Promise<boolean>;

  /**
   * Checks whether a permit is currently held (present and unexpired).
   *
   * @param key - Full semaphore key in Redis
   * @param permitId - Permit id to check
   * @returns True if the permit is live
   */
  isHeld(key: string, permitId: string): Promise<boolean>;

  /**
   * Counts currently held (unexpired) permits.
   *
   * @param key - Full semaphore key in Redis
   * @returns Number of live permits
   */
  usedPermits(key: string): Promise<number>;

  /**
   * Force-releases every permit on the semaphore (admin operation).
   *
   * @param key - Full semaphore key in Redis
   * @returns Number of permits that were held
   */
  forceReleaseAll(key: string): Promise<number>;
}
