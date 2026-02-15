import { ILockOptions } from '../../../shared/types';
import { ILock } from '../../domain/entities/lock.entity';

/**
 * Lock service interface for distributed lock operations.
 *
 * Provides high-level lock acquisition and management functionality
 * with automatic retry, timeout, and renewal capabilities.
 */
export interface ILockService {
  /**
   * Acquires a distributed lock with retry.
   *
   * Attempts to acquire the lock, retrying with exponential backoff
   * if the lock is held by another process. Throws if all retries
   * are exhausted.
   *
   * @param key - Lock key (will be prefixed with module's keyPrefix)
   * @param options - Lock options (TTL, retry config, auto-renewal)
   * @returns Lock instance that must be released
   * @throws {LockAcquisitionError} If lock cannot be acquired after all retries
   *
   * @example
   * ```typescript
   * const lock = await lockService.acquire('user:123', {
   *   ttl: 30000,
   *   autoRenew: true,
   * });
   *
   * try {
   *   // Critical section
   *   await updateUser(123);
   * } finally {
   *   await lock.release();
   * }
   * ```
   */
  acquire(key: string, options?: ILockOptions): Promise<ILock>;

  /**
   * Attempts to acquire lock without retry.
   *
   * Makes a single attempt to acquire the lock.
   * Returns null if lock is held by another process.
   *
   * @param key - Lock key (will be prefixed with module's keyPrefix)
   * @param options - Lock options (TTL, auto-renewal)
   * @returns Lock instance or null if unavailable
   *
   * @example
   * ```typescript
   * const lock = await lockService.tryAcquire('cron:daily-sync');
   * if (!lock) {
   *   console.log('Sync already running');
   *   return;
   * }
   *
   * try {
   *   await performSync();
   * } finally {
   *   await lock.release();
   * }
   * ```
   */
  tryAcquire(key: string, options?: ILockOptions): Promise<ILock | null>;

  /**
   * Executes function with automatic lock management.
   *
   * Acquires lock, executes function, and releases lock in finally block.
   * Lock is released even if function throws an error.
   *
   * @param key - Lock key
   * @param fn - Function to execute while holding lock
   * @param options - Lock options
   * @returns Result of function execution
   * @throws {LockAcquisitionError} If lock cannot be acquired
   * @throws Any error thrown by fn
   *
   * @example
   * ```typescript
   * const result = await lockService.withLock(
   *   'order:123',
   *   async () => {
   *     return await processOrder(123);
   *   },
   *   { ttl: 60000 }
   * );
   * ```
   */
  withLock<T>(key: string, fn: () => Promise<T>, options?: ILockOptions): Promise<T>;

  /**
   * Checks if key is currently locked.
   *
   * @param key - Lock key to check
   * @returns True if lock exists in Redis
   *
   * @example
   * ```typescript
   * if (await lockService.isLocked('payment:456')) {
   *   console.log('Payment is being processed');
   * }
   * ```
   */
  isLocked(key: string): Promise<boolean>;

  /**
   * Force releases a lock (admin operation).
   *
   * Removes lock regardless of ownership. Use with caution as this
   * can break critical sections if another process holds the lock.
   *
   * @param key - Lock key to release
   * @returns True if lock was removed
   *
   * @example
   * ```typescript
   * // Emergency unlock if process crashed
   * await lockService.forceRelease('stuck-lock');
   * ```
   */
  forceRelease(key: string): Promise<boolean>;
}
