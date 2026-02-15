import { IIdempotencyRecord, IIdempotencyCheckResult, IIdempotencyResponse, IIdempotencyOptions } from '../../../shared/types';

/**
 * Service port for idempotency operations
 */
export interface IIdempotencyService {
  /**
   * Check if key exists and acquire lock if not.
   *
   * @param key - Idempotency key
   * @param fingerprint - Request fingerprint hash
   * @param options - Operation options
   * @returns Check result with isNew flag and optional record
   */
  checkAndLock(key: string, fingerprint: string, options?: IIdempotencyOptions): Promise<IIdempotencyCheckResult>;

  /**
   * Store successful response.
   *
   * @param key - Idempotency key
   * @param response - Response to store
   * @param options - Operation options
   */
  complete(key: string, response: IIdempotencyResponse, options?: IIdempotencyOptions): Promise<void>;

  /**
   * Mark request as failed.
   *
   * @param key - Idempotency key
   * @param error - Error message
   */
  fail(key: string, error: string): Promise<void>;

  /**
   * Get existing record by key.
   *
   * @param key - Idempotency key
   * @returns Record or null if not found
   */
  get(key: string): Promise<IIdempotencyRecord | null>;

  /**
   * Delete record (for testing/admin).
   *
   * @param key - Idempotency key
   * @returns True if deleted, false if not found
   */
  delete(key: string): Promise<boolean>;
}
