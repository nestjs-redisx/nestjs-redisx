/**
 * Leader store port.
 * Defines the contract for the lease-backed election storage.
 * Implementation is in the infrastructure layer (RedisLeaderStoreAdapter).
 */
export interface ILeaderStore {
  /**
   * Try to acquire the lease (SET NX PX semantics).
   *
   * @param key - Election key
   * @param instanceId - This instance's identity
   * @param ttlMs - Lease TTL in milliseconds
   * @returns true when this instance became the leader
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
