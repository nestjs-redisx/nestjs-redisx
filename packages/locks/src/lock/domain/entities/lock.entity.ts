import { LockNotOwnedError, LockExtensionError } from '../../../shared/errors';
import { ILockStore } from '../../application/ports/lock-store.port';

/**
 * Represents an acquired distributed lock.
 */
export interface ILock {
  /** Lock key */
  readonly key: string;

  /** Unique token identifying lock ownership */
  readonly token: string;

  /** Lock TTL in milliseconds */
  readonly ttl: number;

  /** Timestamp when lock was acquired */
  readonly acquiredAt: Date;

  /** Timestamp when lock will expire */
  readonly expiresAt: Date;

  /** Whether auto-renewal is active */
  readonly isAutoRenewing: boolean;

  /**
   * Releases the lock.
   *
   * @throws {LockNotOwnedError} If lock is not owned by this token
   */
  release(): Promise<void>;

  /**
   * Extends lock TTL.
   *
   * @param ttl - New TTL in milliseconds
   * @throws {LockNotOwnedError} If lock was already released
   * @throws {LockExtensionError} If extension fails
   */
  extend(ttl: number): Promise<void>;

  /**
   * Checks if lock is still held.
   *
   * @returns True if lock is held by this token
   */
  isHeld(): Promise<boolean>;

  /**
   * Stops automatic lock renewal.
   */
  stopAutoRenew(): void;
}

/**
 * Lock entity implementation.
 *
 * Represents a distributed lock with automatic renewal capability.
 * The lock maintains ownership through a unique token and can be
 * extended or released explicitly.
 *
 * @example
 * ```typescript
 * const lock = new Lock('my-resource', 'token-123', 30000, store);
 *
 * // Start auto-renewal every 15 seconds
 * lock.startAutoRenew(15000);
 *
 * try {
 *   // Do work...
 *   await performOperation();
 * } finally {
 *   await lock.release();
 * }
 * ```
 */
export class Lock implements ILock {
  readonly key: string;
  readonly token: string;
  readonly ttl: number;
  readonly acquiredAt: Date;

  private _expiresAt: Date;
  private autoRenewTimer: NodeJS.Timeout | null = null;
  private released = false;

  /**
   * Creates a new Lock instance.
   *
   * @param key - Lock key in Redis
   * @param token - Unique ownership token
   * @param ttl - Time-to-live in milliseconds
   * @param store - Lock store for persistence operations
   */
  constructor(
    key: string,
    token: string,
    ttl: number,
    private readonly store: ILockStore,
  ) {
    this.key = key;
    this.token = token;
    this.ttl = ttl;
    this.acquiredAt = new Date();
    this._expiresAt = new Date(Date.now() + ttl);
  }

  /**
   * Gets the expiration timestamp.
   */
  get expiresAt(): Date {
    return this._expiresAt;
  }

  /**
   * Checks if auto-renewal is active.
   */
  get isAutoRenewing(): boolean {
    return this.autoRenewTimer !== null;
  }

  /**
   * Releases the lock.
   *
   * Stops auto-renewal and removes the lock from Redis.
   * Idempotent - can be called multiple times safely.
   *
   * @throws {LockNotOwnedError} If lock is not owned by this token
   */
  async release(): Promise<void> {
    if (this.released) {
      return;
    }

    this.stopAutoRenew();

    const success = await this.store.release(this.key, this.token);
    if (!success) {
      throw new LockNotOwnedError(this.key, this.token);
    }

    this.released = true;
  }

  /**
   * Extends the lock TTL.
   *
   * @param ttl - New TTL in milliseconds
   * @throws {LockNotOwnedError} If lock was already released
   * @throws {LockExtensionError} If extension fails (lock expired or not owned)
   */
  async extend(ttl: number): Promise<void> {
    if (this.released) {
      throw new LockNotOwnedError(this.key, this.token);
    }

    const success = await this.store.extend(this.key, this.token, ttl);
    if (!success) {
      throw new LockExtensionError(this.key, this.token);
    }

    this._expiresAt = new Date(Date.now() + ttl);
  }

  /**
   * Checks if lock is still held.
   *
   * @returns False if released, otherwise checks Redis
   */
  async isHeld(): Promise<boolean> {
    if (this.released) {
      return false;
    }
    return this.store.isHeldBy(this.key, this.token);
  }

  /**
   * Starts automatic lock renewal.
   *
   * The lock will be extended at the specified interval
   * until stopAutoRenew() is called or extension fails.
   *
   * @param intervalMs - Renewal interval in milliseconds
   */
  startAutoRenew(intervalMs: number): void {
    if (this.autoRenewTimer) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    this.autoRenewTimer = setInterval(async () => {
      try {
        await this.extend(this.ttl);
      } catch {
        // Extension failed, stop renewing
        this.stopAutoRenew();
      }
    }, intervalMs);

    // Don't prevent Node.js process from exiting
    if (this.autoRenewTimer.unref) {
      this.autoRenewTimer.unref();
    }
  }

  /**
   * Stops automatic lock renewal.
   *
   * Safe to call multiple times.
   */
  stopAutoRenew(): void {
    if (this.autoRenewTimer) {
      clearInterval(this.autoRenewTimer);
      this.autoRenewTimer = null;
    }
  }
}
