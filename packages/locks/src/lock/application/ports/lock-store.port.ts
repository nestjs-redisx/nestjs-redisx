/**
 * Lock store interface for low-level Redis operations.
 *
 * Provides atomic lock operations using Redis primitives.
 * Implementation should use Lua scripts for atomic release/extend.
 */
export interface ILockStore {
  /**
   * Attempts to acquire lock atomically.
   *
   * Uses Redis SET NX PX command to acquire lock only if it doesn't exist.
   *
   * @param key - Full lock key in Redis
   * @param token - Unique ownership token
   * @param ttlMs - Lock TTL in milliseconds
   * @returns True if lock was acquired, false if already held
   */
  acquire(key: string, token: string, ttlMs: number): Promise<boolean>;

  /**
   * Releases lock if owned by token.
   *
   * Uses Lua script to atomically check ownership and delete.
   *
   * @param key - Full lock key in Redis
   * @param token - Ownership token to verify
   * @returns True if lock was released, false if not owned or expired
   */
  release(key: string, token: string): Promise<boolean>;

  /**
   * Extends lock TTL if owned by token.
   *
   * Uses Lua script to atomically check ownership and extend.
   *
   * @param key - Full lock key in Redis
   * @param token - Ownership token to verify
   * @param ttlMs - New TTL in milliseconds
   * @returns True if lock was extended, false if not owned or expired
   */
  extend(key: string, token: string, ttlMs: number): Promise<boolean>;

  /**
   * Checks if lock key exists.
   *
   * @param key - Full lock key in Redis
   * @returns True if key exists (regardless of ownership)
   */
  exists(key: string): Promise<boolean>;

  /**
   * Checks if lock is held by specific token.
   *
   * @param key - Full lock key in Redis
   * @param token - Token to check
   * @returns True if lock exists and matches token
   */
  isHeldBy(key: string, token: string): Promise<boolean>;

  /**
   * Force removes lock without ownership check.
   *
   * @param key - Full lock key in Redis
   * @returns True if lock was removed
   */
  forceRelease(key: string): Promise<boolean>;
}
