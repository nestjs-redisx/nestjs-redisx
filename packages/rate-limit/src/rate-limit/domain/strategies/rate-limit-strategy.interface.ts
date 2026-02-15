import { IRateLimitResult } from '../../../shared/types';

/**
 * Configuration for rate limit strategy.
 */
export interface IStrategyConfig {
  /**
   * Max requests (for fixed/sliding window).
   */
  points?: number;

  /**
   * Window duration in seconds.
   */
  duration?: number;

  /**
   * Bucket capacity (for token bucket).
   */
  capacity?: number;

  /**
   * Refill rate in tokens per second (for token bucket).
   */
  refillRate?: number;
}

/**
 * Rate limit strategy interface.
 * Strategies define how rate limiting is calculated and enforced.
 */
export interface IRateLimitStrategy {
  /**
   * Strategy name.
   */
  readonly name: 'fixed-window' | 'sliding-window' | 'token-bucket';

  /**
   * Check and consume rate limit.
   *
   * @param key - Rate limit key
   * @param config - Strategy configuration
   * @returns Rate limit result
   */
  check(key: string, config: IStrategyConfig): Promise<IRateLimitResult>;

  /**
   * Get Lua script for this strategy.
   * Scripts are loaded once on module init.
   *
   * @returns Lua script as string
   */
  getScript(): string;
}

// Type alias for backward compatibility (non-I-prefixed)
export type StrategyConfig = IStrategyConfig;
