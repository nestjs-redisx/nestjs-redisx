import { IRateLimitResult, IRateLimitConfig, IRateLimitState } from '../../../shared/types';

/**
 * Rate limit service port.
 * Defines the contract for rate limiting operations.
 */
export interface IRateLimitService {
  /**
   * Check and consume rate limit.
   *
   * @param key - Rate limit key (will be prefixed with configured prefix)
   * @param config - Rate limit configuration (overrides defaults)
   * @returns Rate limit result with allowed status
   *
   * @throws {RateLimitScriptError} When Lua script execution fails
   *
   * @example
   * ```typescript
   * const result = await rateLimitService.check('user:123', {
   *   algorithm: 'sliding-window',
   *   points: 100,
   *   duration: 60,
   * });
   *
   * if (!result.allowed) {
   *   throw new Error(`Rate limit exceeded. Retry after ${result.retryAfter}s`);
   * }
   * ```
   */
  check(key: string, config?: IRateLimitConfig): Promise<IRateLimitResult>;

  /**
   * Check without consuming.
   * Useful for previewing rate limit status without affecting counters.
   *
   * @param key - Rate limit key
   * @param config - Rate limit configuration
   * @returns Rate limit result without consuming
   *
   * @example
   * ```typescript
   * const result = await rateLimitService.peek('user:123');
   * console.log(`Remaining: ${result.remaining}/${result.limit}`);
   * ```
   */
  peek(key: string, config?: IRateLimitConfig): Promise<IRateLimitResult>;

  /**
   * Reset rate limit for key.
   * Removes all tracking data for the specified key.
   *
   * @param key - Rate limit key to reset
   *
   * @example
   * ```typescript
   * await rateLimitService.reset('user:123');
   * ```
   */
  reset(key: string): Promise<void>;

  /**
   * Get current state.
   * Returns human-readable state for monitoring.
   *
   * @param key - Rate limit key
   * @param config - Rate limit configuration
   * @returns Current state with Date objects
   *
   * @example
   * ```typescript
   * const state = await rateLimitService.getState('user:123');
   * console.log(`Used: ${state.current}/${state.limit}`);
   * console.log(`Resets at: ${state.resetAt.toISOString()}`);
   * ```
   */
  getState(key: string, config?: IRateLimitConfig): Promise<IRateLimitState>;
}
