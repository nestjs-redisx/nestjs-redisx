import { Logger } from '@nestjs/common';

import { SemaphorePermitNotHeldError, SemaphoreExtensionError } from '../../../shared/errors';
import { ISemaphoreStore } from '../../application/ports/semaphore-store.port';

/**
 * Represents one acquired semaphore permit (a leased seat).
 */
export interface ISemaphorePermit {
  /** Semaphore key the permit belongs to */
  readonly key: string;

  /** Unique permit id identifying this holder */
  readonly permitId: string;

  /** Permit TTL in milliseconds */
  readonly ttl: number;

  /** Timestamp when the permit was acquired */
  readonly acquiredAt: Date;

  /** Timestamp when the permit expires unless renewed */
  readonly expiresAt: Date;

  /** Whether auto-renewal is active */
  readonly isAutoRenewing: boolean;

  /**
   * Releases the permit (frees the seat). Idempotent.
   *
   * @throws {SemaphorePermitNotHeldError} If the permit already expired or
   *   was force-released — the seat was NOT protected for the full duration.
   */
  release(): Promise<void>;

  /**
   * Extends the permit TTL.
   *
   * @param ttl - New TTL in milliseconds (from now)
   * @throws {SemaphorePermitNotHeldError} If the permit was already released
   * @throws {SemaphoreExtensionError} If the permit expired on the store
   */
  extend(ttl: number): Promise<void>;

  /**
   * Checks whether the permit is still held.
   */
  isHeld(): Promise<boolean>;

  /**
   * Stops automatic permit renewal.
   */
  stopAutoRenew(): void;
}

/**
 * Semaphore permit entity.
 *
 * A leased seat on a counting semaphore with optional automatic renewal —
 * the distributed analogue of holding one slot of a bounded worker pool.
 *
 * @example
 * ```typescript
 * const permit = await semaphoreService.acquire('renders', 4, { ttl: 30000 });
 * try {
 *   await renderVideo();
 * } finally {
 *   await permit.release();
 * }
 * ```
 */
export class SemaphorePermit implements ISemaphorePermit {
  readonly key: string;
  readonly permitId: string;
  readonly ttl: number;
  readonly acquiredAt: Date;

  private readonly logger = new Logger(SemaphorePermit.name);
  private _expiresAt: Date;
  private autoRenewTimer: NodeJS.Timeout | null = null;
  private released = false;

  /**
   * @param key - Full semaphore key in Redis
   * @param permitId - Unique holder id
   * @param ttl - Time-to-live in milliseconds
   * @param store - Semaphore store for persistence operations
   */
  constructor(
    key: string,
    permitId: string,
    ttl: number,
    private readonly store: ISemaphoreStore,
  ) {
    this.key = key;
    this.permitId = permitId;
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
   * Checks whether auto-renewal is active.
   */
  get isAutoRenewing(): boolean {
    return this.autoRenewTimer !== null;
  }

  /**
   * Releases the permit.
   *
   * Stops auto-renewal and frees the seat. Idempotent — repeated calls are
   * no-ops. Throws when the store no longer holds the permit: the seat
   * expired (or was force-released) before the work finished, so the
   * concurrency bound was NOT honored for the full duration.
   */
  async release(): Promise<void> {
    if (this.released) {
      return;
    }

    this.stopAutoRenew();

    const success = await this.store.release(this.key, this.permitId);
    // Mark released BEFORE the ownership check: whatever the outcome, this
    // permit has nothing left to free, and a second release() must be a
    // no-op instead of a second error.
    this.released = true;

    if (!success) {
      throw new SemaphorePermitNotHeldError(this.key, this.permitId);
    }
  }

  /**
   * Extends the permit TTL.
   */
  async extend(ttl: number): Promise<void> {
    if (this.released) {
      throw new SemaphorePermitNotHeldError(this.key, this.permitId);
    }

    const success = await this.store.extend(this.key, this.permitId, ttl, Date.now());
    if (!success) {
      throw new SemaphoreExtensionError(this.key, this.permitId);
    }

    this._expiresAt = new Date(Date.now() + ttl);
  }

  /**
   * Checks whether the permit is still held.
   */
  async isHeld(): Promise<boolean> {
    if (this.released) {
      return false;
    }
    return this.store.isHeld(this.key, this.permitId, Date.now());
  }

  /**
   * Starts automatic permit renewal.
   *
   * The permit is extended at the given interval until stopAutoRenew() is
   * called, release() runs, or an extension fails (permit lost).
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
      } catch (error) {
        // Extension failed — the permit may already be lost. Surface it and
        // stop renewing; callers can detect this via `isAutoRenewing`
        // flipping to false.
        this.logger.warn(`Auto-renewal failed for semaphore permit "${this.permitId}" on "${this.key}"; the permit may have expired and renewal has stopped: ${(error as Error).message}`);
        this.stopAutoRenew();
      }
    }, intervalMs);

    // Don't prevent the Node.js process from exiting
    if (this.autoRenewTimer.unref) {
      this.autoRenewTimer.unref();
    }
  }

  /**
   * Stops automatic permit renewal. Safe to call multiple times.
   */
  stopAutoRenew(): void {
    if (this.autoRenewTimer) {
      clearInterval(this.autoRenewTimer);
      this.autoRenewTimer = null;
    }
  }
}
