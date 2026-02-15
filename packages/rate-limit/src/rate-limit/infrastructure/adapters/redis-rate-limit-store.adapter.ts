import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { IRedisDriver, REDIS_DRIVER } from '@nestjs-redisx/core';

import { RateLimitScriptError } from '../../../shared/errors';
import { IRateLimitResult } from '../../../shared/types';
import { IRateLimitStore } from '../../application/ports/rate-limit-store.port';
import { FIXED_WINDOW_SCRIPT, SLIDING_WINDOW_SCRIPT, TOKEN_BUCKET_SCRIPT } from '../scripts/lua-scripts';

/**
 * Redis-based rate limit store implementation.
 * Uses Lua scripts for atomic operations.
 */
@Injectable()
export class RedisRateLimitStoreAdapter implements IRateLimitStore, OnModuleInit {
  private fixedWindowSha: string | null = null;
  private slidingWindowSha: string | null = null;
  private tokenBucketSha: string | null = null;

  constructor(@Inject(REDIS_DRIVER) private readonly driver: IRedisDriver) {}

  /**
   * Pre-load Lua scripts on module initialization.
   */
  async onModuleInit(): Promise<void> {
    try {
      this.fixedWindowSha = await this.driver.scriptLoad(FIXED_WINDOW_SCRIPT);
      this.slidingWindowSha = await this.driver.scriptLoad(SLIDING_WINDOW_SCRIPT);
      this.tokenBucketSha = await this.driver.scriptLoad(TOKEN_BUCKET_SCRIPT);
    } catch (error) {
      throw new RateLimitScriptError(`Failed to load Lua scripts: ${(error as Error).message}`, error as Error);
    }
  }

  /**
   * Fixed window rate limiting.
   */
  async fixedWindow(key: string, points: number, duration: number): Promise<IRateLimitResult> {
    const now = Math.floor(Date.now() / 1000);

    try {
      const result = await this.driver.evalsha(this.fixedWindowSha!, [key], [points, duration, now]);

      return this.parseFixedWindowResult(result as number[], points);
    } catch (error) {
      // Fallback to eval if script not loaded
      if (this.isNoScriptError(error)) {
        const result = await this.driver.eval(FIXED_WINDOW_SCRIPT, [key], [points, duration, now]);
        return this.parseFixedWindowResult(result as number[], points);
      }

      throw new RateLimitScriptError(`Fixed window check failed: ${(error as Error).message}`, error as Error);
    }
  }

  /**
   * Sliding window rate limiting.
   */
  async slidingWindow(key: string, points: number, duration: number): Promise<IRateLimitResult> {
    const now = Date.now();
    const requestId = `${now}-${Math.random().toString(36).substring(7)}`;

    try {
      const result = await this.driver.evalsha(this.slidingWindowSha!, [key], [points, duration, now, requestId]);

      return this.parseSlidingWindowResult(result as number[], points);
    } catch (error) {
      // Fallback to eval if script not loaded
      if (this.isNoScriptError(error)) {
        const result = await this.driver.eval(SLIDING_WINDOW_SCRIPT, [key], [points, duration, now, requestId]);
        return this.parseSlidingWindowResult(result as number[], points);
      }

      throw new RateLimitScriptError(`Sliding window check failed: ${(error as Error).message}`, error as Error);
    }
  }

  /**
   * Token bucket rate limiting.
   */
  async tokenBucket(key: string, capacity: number, refillRate: number, consume = 1): Promise<IRateLimitResult> {
    const now = Date.now();

    try {
      const result = await this.driver.evalsha(this.tokenBucketSha!, [key], [capacity, refillRate, now, consume]);

      return this.parseTokenBucketResult(result as number[], capacity);
    } catch (error) {
      // Fallback to eval if script not loaded
      if (this.isNoScriptError(error)) {
        const result = await this.driver.eval(TOKEN_BUCKET_SCRIPT, [key], [capacity, refillRate, now, consume]);
        return this.parseTokenBucketResult(result as number[], capacity);
      }

      throw new RateLimitScriptError(`Token bucket check failed: ${(error as Error).message}`, error as Error);
    }
  }

  /**
   * Peek current state without consuming.
   * Note: This is a simplified implementation.
   * For accurate peek, we would need separate Lua scripts.
   */
  async peek(key: string, algorithm: string, config: Record<string, number>): Promise<IRateLimitResult> {
    // Simplified: Use GET/ZCARD to check current state
    // This is not perfect but avoids consuming
    try {
      if (algorithm === 'fixed-window') {
        const now = Math.floor(Date.now() / 1000);
        const duration = config.duration || 60;
        const window = Math.floor(now / duration) * duration;
        const windowKey = `${key}:${window}`;
        const currentStr = await this.driver.get(windowKey);
        const current = currentStr ? parseInt(currentStr, 10) : 0;
        const points = config.points || 100;

        return {
          allowed: current < points,
          limit: points,
          remaining: Math.max(0, points - current),
          reset: window + duration,
          current,
        };
      } else if (algorithm === 'sliding-window') {
        const count = await this.driver.zcard(key);
        const points = config.points || 100;
        const duration = config.duration || 60;

        return {
          allowed: count < points,
          limit: points,
          remaining: Math.max(0, points - count),
          reset: Math.floor(Date.now() / 1000) + duration,
          current: count,
        };
      }

      // Token bucket peek would require HMGET
      const points = config.capacity || 100;
      return {
        allowed: true,
        limit: points,
        remaining: points,
        reset: Math.floor(Date.now() / 1000) + 60,
        current: 0,
      };
    } catch (error) {
      throw new RateLimitScriptError(`Peek failed: ${(error as Error).message}`, error as Error);
    }
  }

  /**
   * Reset rate limit key.
   */
  async reset(key: string): Promise<void> {
    try {
      await this.driver.del(key);
    } catch (error) {
      throw new RateLimitScriptError(`Reset failed: ${(error as Error).message}`, error as Error);
    }
  }

  /**
   * Parse fixed window script result.
   * Returns: {allowed, remaining, reset, current}
   */
  private parseFixedWindowResult(result: number[], limit: number): IRateLimitResult {
    const allowed = result[0] ?? 0;
    const remaining = result[1] ?? 0;
    const reset = result[2] ?? 0;
    const current = result[3] ?? 0;

    return {
      allowed: allowed === 1,
      limit,
      remaining,
      reset,
      current,
      retryAfter: allowed === 0 ? Math.ceil(reset - Date.now() / 1000) : undefined,
    };
  }

  /**
   * Parse sliding window script result.
   * Returns: {allowed, remaining, reset, current, retryAfter?}
   */
  private parseSlidingWindowResult(result: number[], limit: number): IRateLimitResult {
    const allowed = result[0] ?? 0;
    const remaining = result[1] ?? 0;
    const reset = result[2] ?? 0;
    const current = result[3] ?? 0;
    const retryAfter = result[4];

    return {
      allowed: allowed === 1,
      limit,
      remaining,
      reset,
      current,
      retryAfter: retryAfter ? Math.max(0, retryAfter) : undefined,
    };
  }

  /**
   * Parse token bucket script result.
   * Returns: {allowed, remaining, reset, current, retryAfter?}
   */
  private parseTokenBucketResult(result: number[], capacity: number): IRateLimitResult {
    const allowed = result[0] ?? 0;
    const remaining = result[1] ?? 0;
    const reset = result[2] ?? 0;
    const current = result[3] ?? 0;
    const retryAfter = result[4];

    return {
      allowed: allowed === 1,
      limit: capacity,
      remaining,
      reset, // Unix timestamp when bucket will be full again
      current,
      retryAfter: retryAfter ? Math.max(0, retryAfter) : undefined,
    };
  }

  /**
   * Check if error is NOSCRIPT error.
   */
  private isNoScriptError(error: unknown): boolean {
    const message = (error as Error).message;
    return message.includes('NOSCRIPT') || message.includes('No matching script');
  }
}
