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
   *   was force-released - the seat was NOT protected for the full duration.
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
 * A leased seat on a counting semaphore with optional automatic renewal -
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
  /** Single-flight gate: concurrent release() calls share ONE store round-trip. */
  private releasing: Promise<void> | null = null;

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
   * Stops auto-renewal and frees the seat. Idempotent - repeated calls are
   * no-ops. Throws when the store no longer holds the permit: the seat
   * expired (or was force-released) before the work finished, so the
   * concurrency bound was NOT honored for the full duration.
   */
  async release(): Promise<void> {
    if (this.released) {
      return;
    }
    // Single-flight: a second concurrent release() (user finally racing
    // another path) must share the SAME outcome instead of issuing a second
    // ZREM - the loser of a double-ZREM would see 0 and throw a FALSE
    // SemaphorePermitNotHeldError for a perfectly clean release.
    if (this.releasing) {
      return this.releasing;
    }
    this.releasing = this.doRelease();
    return this.releasing;
  }

  private async doRelease(): Promise<void> {
    this.stopAutoRenew();

    const success = await this.store.release(this.key, this.permitId);
    // Mark released BEFORE the ownership check: whatever the outcome, this
    // permit has nothing left to free, and a later release() must be a
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

    const success = await this.store.extend(this.key, this.permitId, ttl);
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
    return this.store.isHeld(this.key, this.permitId);
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
        // Two distinct failures, two distinct policies:
        // - the PERMIT is gone (store confirmed: extension refused /
        //   already released) -> stop renewing, the seat is lost;
        // - the STORE is unreachable (transient outage, OOM aborting the
        //   re-score ZADD, failover blip) -> KEEP RETRYING while the lease
        //   still has life in it: a single blip must not strand a long job
        //   whose seat was perfectly recoverable. Once the local expiry
        //   passes, the seat is gone anyway (crash bound) - stop.
        // Containment is TOTAL: a nullish rejection must not mint a
        // TypeError inside this catch (an unhandled rejection in a timer
        // callback crashes the process), and a throwing log line must not
        // keep a dead permit's timer alive.
        const permitLost = error instanceof SemaphorePermitNotHeldError || error instanceof SemaphoreExtensionError;
        const leaseLapsed = Date.now() >= this._expiresAt.getTime();
        if (permitLost || leaseLapsed) {
          this.stopAutoRenew();
        }
        try {
          const description = error instanceof Error ? error.message : String(error);
          if (permitLost || leaseLapsed) {
            this.logger.warn(`Auto-renewal stopped for semaphore permit "${this.permitId}" on "${this.key}" (${permitLost ? 'permit lost' : 'lease lapsed during a store outage'}): ${description}`);
          } else {
            this.logger.warn(`Auto-renewal attempt failed for semaphore permit "${this.permitId}" on "${this.key}" (transient store error, will retry): ${description}`);
          }
        } catch {
          // logging must never break the containment
        }
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
