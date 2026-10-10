import { ISemaphoreOptions } from '../../../shared/types';
import { ISemaphorePermit } from '../../domain/entities/semaphore-permit.entity';

/**
 * Semaphore service interface — bound concurrency across instances.
 *
 * A counting semaphore allows at most `permits` concurrent holders of the
 * same key across the whole fleet. Each holder gets a leased permit that
 * expires on crash (TTL) and can be auto-renewed while work is running.
 *
 * The capacity is passed at the call site and MUST be the same for every
 * caller of a given key (like rate-limit limits): the store enforces
 * whatever capacity the acquiring call provides.
 */
export interface ISemaphoreService {
  /**
   * Acquires a permit with retry and exponential backoff.
   *
   * @param key - Semaphore key (prefixed with the plugin keyPrefix)
   * @param permits - Semaphore capacity (max concurrent holders)
   * @param options - Permit options (TTL, waitTimeout, retry, auto-renewal)
   * @returns A permit that must be released
   * @throws {SemaphoreAcquisitionError} reason 'exhausted' (retry cap ran
   *   out), 'timeout' (waitTimeout budget ran out), 'error' (store outage —
   *   cause carries the driver error), or 'shutdown' (service destroyed)
   * @throws {InvalidSemaphoreConfigError} On invalid key/capacity/options
   *
   * @example
   * ```typescript
   * const permit = await semaphore.acquire('reports:render', 5, { ttl: 60000 });
   * try {
   *   await renderReport();
   * } finally {
   *   await permit.release();
   * }
   * ```
   */
  acquire(key: string, permits: number, options?: ISemaphoreOptions): Promise<ISemaphorePermit>;

  /**
   * Attempts to acquire a permit once, without retry.
   *
   * @param key - Semaphore key
   * @param permits - Semaphore capacity
   * @param options - Permit options (TTL, auto-renewal)
   * @returns A permit, or null when the semaphore is full
   *
   * @example
   * ```typescript
   * const permit = await semaphore.tryAcquire('imports', 2);
   * if (!permit) return; // at capacity — skip this round
   * ```
   */
  tryAcquire(key: string, permits: number, options?: ISemaphoreOptions): Promise<ISemaphorePermit | null>;

  /**
   * Executes a function while holding a permit; always releases afterwards.
   *
   * @param key - Semaphore key
   * @param permits - Semaphore capacity
   * @param fn - Function to execute while holding the permit
   * @param options - Permit options
   * @returns The function's result
   * @throws {SemaphoreAcquisitionError} When no permit frees up in time
   * @throws Whatever `fn` throws
   *
   * @example
   * ```typescript
   * const data = await semaphore.withPermit('external-api', 10, () => callApi());
   * ```
   */
  withPermit<T>(key: string, permits: number, fn: () => Promise<T>, options?: ISemaphoreOptions): Promise<T>;

  /**
   * Counts currently held (unexpired) permits for a key.
   *
   * @param key - Semaphore key
   * @returns Number of live permits
   */
  usedPermits(key: string): Promise<number>;

  /**
   * Computes free capacity for a key at the given capacity.
   *
   * @param key - Semaphore key
   * @param permits - Semaphore capacity
   * @returns `permits` minus live holders (never below 0)
   */
  availablePermits(key: string, permits: number): Promise<number>;

  /**
   * Force-releases every permit on a key (admin operation).
   *
   * Frees all seats regardless of ownership. In-flight holders keep
   * running; their eventual release() throws SemaphorePermitNotHeldError —
   * the honest signal that the seat was taken away from under their work
   * (withPermit and @WithSemaphore absorb it into an error log). Use for
   * operator recovery.
   *
   * @param key - Semaphore key
   * @returns Number of LIVE permits that were displaced
   */
  forceReleaseAll(key: string): Promise<number>;
}
