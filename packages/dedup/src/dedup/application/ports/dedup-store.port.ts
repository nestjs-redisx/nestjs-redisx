/**
 * Dedup store interface for low-level Redis operations.
 *
 * A deduplication marker is a plain key holding the first caller's token
 * with the window as its TTL (SET NX PX). The debounce slot is a plain key
 * holding the LAST caller's id.
 */
export interface IDedupStore {
  /**
   * Attempts to set the first-occurrence marker atomically.
   *
   * @param key - Full marker key in Redis
   * @param token - Unique token identifying this caller
   * @param windowMs - Deduplication window in milliseconds
   * @returns True if this caller is the first in the window
   */
  markFirst(key: string, token: string, windowMs: number): Promise<boolean>;

  /**
   * Releases the marker only if owned by the token (Lua CAS) — re-opens the
   * window after a failed first execution without erasing a newer marker.
   *
   * @param key - Full marker key in Redis
   * @param token - Token to verify
   * @returns True if the marker was removed
   */
  releaseIfOwner(key: string, token: string): Promise<boolean>;

  /**
   * Removes the marker unconditionally (manual/admin release).
   *
   * @param key - Full marker key in Redis
   * @returns True if a marker existed
   */
  release(key: string): Promise<boolean>;

  /**
   * Records this caller as the LAST one for a debounce key (overwrites any
   * previous caller), refreshing the slot TTL.
   *
   * @param key - Full debounce slot key in Redis
   * @param callId - Unique id of this call
   * @param ttlMs - Slot TTL in milliseconds (window + grace)
   */
  stampLastCall(key: string, callId: string, ttlMs: number): Promise<void>;

  /**
   * Atomically claims the debounce slot if this caller is still the last
   * one (Lua CAS + delete).
   *
   * @param key - Full debounce slot key in Redis
   * @param callId - This caller's id
   * @returns True if the claim succeeded — the caller must execute
   */
  claimLastCall(key: string, callId: string): Promise<boolean>;
}
