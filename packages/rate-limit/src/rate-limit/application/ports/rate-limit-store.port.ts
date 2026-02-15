import { IRateLimitResult } from '../../../shared/types';

/**
 * Rate limit store port.
 * Defines the contract for Redis-backed rate limit storage.
 * Implementation is in infrastructure layer (RedisRateLimitStoreAdapter).
 */
export interface IRateLimitStore {
  /**
   * Fixed window algorithm.
   * Simple counter that resets at fixed intervals.
   *
   * @param key - Rate limit key
   * @param points - Max requests per window
   * @param duration - Window duration in seconds
   * @returns Rate limit result
   */
  fixedWindow(key: string, points: number, duration: number): Promise<IRateLimitResult>;

  /**
   * Sliding window algorithm.
   * Tracks individual request timestamps for precise limiting.
   *
   * @param key - Rate limit key
   * @param points - Max requests per window
   * @param duration - Window duration in seconds
   * @returns Rate limit result
   */
  slidingWindow(key: string, points: number, duration: number): Promise<IRateLimitResult>;

  /**
   * Token bucket algorithm.
   * Smooth rate limiting with burst allowance.
   *
   * @param key - Rate limit key
   * @param capacity - Bucket capacity (max tokens)
   * @param refillRate - Tokens per second
   * @param consume - Tokens to consume (default: 1)
   * @returns Rate limit result
   */
  tokenBucket(key: string, capacity: number, refillRate: number, consume?: number): Promise<IRateLimitResult>;

  /**
   * Peek current state without consuming.
   *
   * @param key - Rate limit key
   * @param algorithm - Algorithm name
   * @param config - Algorithm-specific configuration
   * @returns Rate limit result without consuming
   */
  peek(key: string, algorithm: string, config: Record<string, number>): Promise<IRateLimitResult>;

  /**
   * Reset/delete rate limit key.
   *
   * @param key - Rate limit key to delete
   */
  reset(key: string): Promise<void>;
}
