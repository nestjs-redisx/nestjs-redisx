import { IIdempotencyRecord } from '../../../shared/types';

/**
 * Result of check and lock operation
 */
export interface ICheckAndLockResult {
  /** Status of the check */
  status: 'new' | 'processing' | 'completed' | 'failed' | 'fingerprint_mismatch';

  /** Record if exists */
  record?: IIdempotencyRecord;
}

/**
 * Data for completing a request
 */
export interface ICompleteData {
  /** HTTP status code */
  statusCode: number;

  /** Response body (JSON string) */
  response: string;

  /** Response headers (JSON string) */
  headers?: string;

  /** Completion timestamp (ms) */
  completedAt: number;
}

/**
 * Store port for Redis operations
 */
export interface IIdempotencyStore {
  /**
   * Atomic check and lock operation using Lua script.
   *
   * @param key - Redis key
   * @param fingerprint - Request fingerprint hash
   * @param lockTimeoutMs - Lock timeout in milliseconds
   * @returns Check result
   */
  checkAndLock(key: string, fingerprint: string, lockTimeoutMs: number): Promise<ICheckAndLockResult>;

  /**
   * Mark record as completed with response data.
   *
   * @param key - Redis key
   * @param data - Completion data
   * @param ttlSeconds - TTL in seconds
   */
  complete(key: string, data: ICompleteData, ttlSeconds: number): Promise<void>;

  /**
   * Mark record as failed.
   *
   * @param key - Redis key
   * @param error - Error message
   */
  fail(key: string, error: string): Promise<void>;

  /**
   * Get record by key.
   *
   * @param key - Redis key
   * @returns Record or null if not found
   */
  get(key: string): Promise<IIdempotencyRecord | null>;

  /**
   * Delete record.
   *
   * @param key - Redis key
   * @returns True if deleted, false if not found
   */
  delete(key: string): Promise<boolean>;
}
