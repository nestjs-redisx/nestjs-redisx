/**
 * Leader store port.
 * Defines the contract for the lease-backed election storage.
 * Implementation is in the infrastructure layer (RedisLeaderStoreAdapter).
 */
export interface ILeaderStore {
  /**
   * Try to acquire the lease, atomically re-claiming it when this instance is
   * already the holder (SET NX PX, else same-holder PEXPIRE). Re-claim covers
   * a stale own lease — after an unconfirmed renewal or a restart with a
   * stable instanceId — and can never take a seat held by another instance.
   *
   * @param key - Election key
   * @param instanceId - This instance's identity
   * @param ttlMs - Lease TTL in milliseconds
   * @returns true when the lease is now held by this instance
   */
  acquire(key: string, instanceId: string, ttlMs: number): Promise<boolean>;

  /**
   * Renew the lease if — and only if — this instance still holds it (CAS).
   *
   * @returns true when the lease was extended; false when the key is gone or
   * held by someone else
   */
  renew(key: string, instanceId: string, ttlMs: number): Promise<boolean>;

  /**
   * Release the lease if this instance holds it (CAS delete).
   *
   * @returns true when the key was deleted by this call
   */
  release(key: string, instanceId: string): Promise<boolean>;

  /**
   * Read the current holder's instance id.
   *
   * @returns the holder id, or null when nobody is leader
   */
  getHolder(key: string): Promise<string | null>;
}
