import { IDedupOptions, IDebounceOptions } from '../../../shared/types';

/**
 * Deduplication service interface - first-wins event markers and
 * distributed trailing debounce.
 *
 * Deduplication here is a LIGHTWEIGHT first-wins marker: "has this key been
 * seen in the window?" - nothing about the execution is stored or replayed.
 * For request-grade idempotency with fingerprints and response replay, use
 * `@nestjs-redisx/idempotency`.
 */
export interface IDedupService {
  /**
   * Checks whether this is the first occurrence of the key in the window,
   * atomically marking it. Strict API: a store failure always throws
   * (the errorPolicy applies only to the gates).
   *
   * @param key - Deduplication key (prefixed with the plugin keyPrefix)
   * @param options - Window override
   * @returns True exactly once per window across all instances
   * @throws {DedupStoreError} When the store is unreachable
   *
   * @example
   * ```typescript
   * if (await dedup.isFirst(`webhook:${event.id}`)) {
   *   await handle(event);
   * }
   * ```
   */
  isFirst(key: string, options?: IDedupOptions): Promise<boolean>;

  /**
   * Runs the function only for the FIRST occurrence of the key in the
   * window; duplicates resolve to undefined without running it.
   *
   * When the function THROWS, this caller's marker is released (best
   * effort), so a retry is not locked out for the rest of the window -
   * failures don't burn the window. A crash (no throw path) leaves the
   * marker until the TTL.
   *
   * Store unavailability follows the plugin errorPolicy: 'fail-open' runs
   * the function (duplicates become possible), 'fail-closed' throws.
   *
   * @param key - Deduplication key
   * @param fn - Function to run for the first occurrence
   * @param options - Window override
   * @returns The function result, or undefined for duplicates
   *
   * @example
   * ```typescript
   * await dedup.dedupe(`order-created:${orderId}`, async () => {
   *   await sendConfirmationEmail(orderId);
   * });
   * ```
   */
  dedupe<T>(key: string, fn: () => Promise<T>, options?: IDedupOptions): Promise<T | undefined>;

  /**
   * Distributed trailing debounce: the function runs once the key has been
   * quiet for the window, on the instance that made the LAST call; earlier
   * calls resolve to undefined.
   *
   * The returned promise settles AFTER the quiet window (it waits). The
   * executing timer lives in-process: if the last-calling instance dies
   * before the window elapses, this round does not execute (best-effort,
   * like an in-process debounce - the next call starts a new round).
   *
   * @param key - Debounce key
   * @param fn - Function to run after the quiet window
   * @param options - Window override
   * @returns The function result on the executing call, undefined on
   *   superseded calls
   *
   * @example
   * ```typescript
   * // Rebuild the search index at most once per quiet minute
   * await dedup.debounce('reindex:products', () => rebuildIndex(), { window: 60000 });
   * ```
   */
  debounce<T>(key: string, fn: () => Promise<T>, options?: IDebounceOptions): Promise<T | undefined>;

  /**
   * Removes a deduplication marker early (admin/manual retry), regardless
   * of which caller set it. Strict API: a store failure always throws.
   *
   * @param key - Deduplication key
   * @returns True if a marker existed
   * @throws {DedupStoreError} When the store is unreachable
   */
  release(key: string): Promise<boolean>;
}
