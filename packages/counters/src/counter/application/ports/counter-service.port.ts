import { ICounterOptions } from '../../../shared/types';

/**
 * Counter service interface — fleet-wide atomic counters and sequences.
 *
 * Every mutation is a single atomic Redis operation: concurrent increments
 * from any number of instances never lose updates. Values are 64-bit
 * integers (JavaScript sees them as numbers; amounts are validated as safe
 * integers).
 */
export interface ICounterService {
  /**
   * Atomically adds `by` (default 1) and returns the new value.
   *
   * With `options.ttl`, the TTL is applied only when this increment CREATES
   * the key — the idiomatic window counter (`stats:2026-10-09` style keys
   * expire on their own; later increments never extend the window).
   *
   * @param key - Counter key (prefixed with the plugin keyPrefix)
   * @param by - Amount to add (non-zero safe integer)
   * @param options - Window TTL
   * @returns The new value
   *
   * @example
   * ```typescript
   * const views = await counters.increment(`views:${articleId}`);
   * await counters.increment(`api:${userId}:${today}`, 1, { ttl: 86_400_000 });
   * ```
   */
  increment(key: string, by?: number, options?: ICounterOptions): Promise<number>;

  /**
   * Atomically subtracts `by` (default 1) and returns the new value.
   * Counters go negative freely — clamp in domain code if needed.
   *
   * @param key - Counter key
   * @param by - Amount to subtract (non-zero safe integer)
   * @param options - Window TTL (first-write only, like increment)
   * @returns The new value
   */
  decrement(key: string, by?: number, options?: ICounterOptions): Promise<number>;

  /**
   * Reads the current value; 0 when the counter does not exist.
   *
   * @param key - Counter key
   * @throws {CounterValueError} When the key holds a non-numeric value
   */
  get(key: string): Promise<number>;

  /**
   * Sets the counter to an absolute value.
   *
   * @param key - Counter key
   * @param value - Safe integer
   * @param options - Optional TTL for the key
   */
  set(key: string, value: number, options?: ICounterOptions): Promise<void>;

  /**
   * Deletes the counter.
   *
   * @param key - Counter key
   * @returns True when a counter existed
   */
  reset(key: string): Promise<boolean>;

  /**
   * Atomically reads and deletes the counter — flush-style consumption for
   * periodic aggregation (read the batch total exactly once).
   *
   * @param key - Counter key
   * @returns The value before deletion (0 when absent)
   *
   * @example
   * ```typescript
   * // Every minute: ship the accumulated total and start from zero
   * const sent = await counters.getAndReset('emails:batch');
   * ```
   */
  getAndReset(key: string): Promise<number>;

  /**
   * Returns the next value of a monotonic sequence (INCR, no TTL) — safe
   * fleet-wide ID generation.
   *
   * @param sequence - Sequence name
   * @returns The next value (1, 2, 3, ... across all instances)
   *
   * @example
   * ```typescript
   * const invoiceNo = await counters.next('seq:invoices');
   * ```
   */
  next(sequence: string): Promise<number>;

  /**
   * Returns the last issued value of a sequence (0 before the first next()).
   *
   * @param sequence - Sequence name
   */
  current(sequence: string): Promise<number>;
}
