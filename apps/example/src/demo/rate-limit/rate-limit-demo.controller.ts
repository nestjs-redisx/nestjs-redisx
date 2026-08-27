/**
 * @fileoverview Controller demonstrating rate limiting.
 *
 * Endpoints:
 * - GET /demo/rate-limit/public - 10 req/min per IP
 * - GET /demo/rate-limit/authenticated - 100 req/min per user
 * - GET /demo/rate-limit/sliding - Sliding window
 * - GET /demo/rate-limit/fixed - Fixed window
 * - GET /demo/rate-limit/token-bucket - Token bucket
 * - GET /demo/rate-limit/memory - In-memory (per-instance) store
 * - GET /demo/rate-limit/strict - Explicitly pinned to the Redis store
 */

import { Controller, Get, Query, Req } from '@nestjs/common';
import { RateLimit } from '@nestjs-redisx/rate-limit';
import { RateLimitDemoService } from './rate-limit-demo.service';
import type { Request } from 'express';

@Controller('demo/rate-limit')
export class RateLimitDemoController {
  constructor(private readonly rateLimitDemo: RateLimitDemoService) {}

  /**
   * Simple test endpoint.
   *
   * @example
   * ```bash
   * curl http://localhost:3000/demo/rate-limit/test
   * ```
   */
  @Get('test')
  async test() {
    return {
      status: 'ok',
      plugin: 'rate-limit',
      message: 'Rate limit plugin is working',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Public endpoint with rate limit per IP.
   *
   * Try making > 10 requests per minute:
   *
   * @example
   * ```bash
   * # Send 15 requests
   * for i in {1..15}; do
   *   curl http://localhost:3000/demo/rate-limit/public
   *   echo ""
   * done
   *
   * # After the 10th request you'll get 429 Too Many Requests
   * ```
   */
  @Get('public')
  @RateLimit({ points: 10, duration: 60 })
  async public() {
    return this.rateLimitDemo.publicEndpoint();
  }

  /**
   * Endpoint for authenticated users.
   *
   * @example
   * ```bash
   * curl "http://localhost:3000/demo/rate-limit/authenticated?userId=user123"
   * ```
   */
  @Get('authenticated')
  @RateLimit({
    points: 100,
    duration: 60,
  })
  async authenticated(@Query('userId') userId: string) {
    return this.rateLimitDemo.authenticatedEndpoint(userId || 'anonymous');
  }

  /**
   * Sliding window algorithm.
   *
   * Provides smooth rate limiting without abrupt resets.
   *
   * @example
   * ```bash
   * curl http://localhost:3000/demo/rate-limit/sliding
   * ```
   */
  @Get('sliding')
  @RateLimit({
    algorithm: 'sliding-window',
    points: 5,
    duration: 30,
  })
  async sliding() {
    return this.rateLimitDemo.slidingWindow();
  }

  /**
   * Fixed window algorithm.
   *
   * Resets the counter at fixed intervals.
   *
   * @example
   * ```bash
   * curl http://localhost:3000/demo/rate-limit/fixed
   * ```
   */
  @Get('fixed')
  @RateLimit({
    algorithm: 'fixed-window',
    points: 5,
    duration: 30,
  })
  async fixed() {
    return this.rateLimitDemo.fixedWindow();
  }

  /**
   * Token bucket algorithm.
   *
   * Allows short bursts of traffic.
   *
   * @example
   * ```bash
   * curl http://localhost:3000/demo/rate-limit/token-bucket
   * ```
   */
  @Get('token-bucket')
  @RateLimit({
    algorithm: 'token-bucket',
    points: 10,
    duration: 60,
  })
  async tokenBucket() {
    return this.rateLimitDemo.tokenBucket();
  }

  /**
   * In-memory (per-instance) store: the counter lives in process memory, so
   * the check adds zero Redis round-trip to the request. Each instance
   * enforces its own limit — ideal for cheap anti-abuse limiting on hot
   * routes when exact global counts are not required.
   *
   * @example
   * ```bash
   * # 6th request within a minute gets 429; no rl:* keys appear in Redis
   * for i in {1..6}; do curl http://localhost:3000/demo/rate-limit/memory; echo ""; done
   * ```
   */
  @Get('memory')
  @RateLimit({
    store: 'memory',
    key: 'memory-demo',
    points: 5,
    duration: 60,
  })
  async memory() {
    return this.rateLimitDemo.memoryStore();
  }

  /**
   * Explicitly pinned to the Redis store: the counter is exact and shared by
   * ALL application instances. Use this for auth-sensitive routes (login,
   * OTP, password reset) even when the plugin default is `store: 'memory'`.
   *
   * @example
   * ```bash
   * # 4th request within a minute gets 429, no matter which instance serves it
   * for i in {1..4}; do curl http://localhost:3000/demo/rate-limit/strict; echo ""; done
   * ```
   */
  @Get('strict')
  @RateLimit({
    store: 'redis',
    key: 'strict-demo',
    points: 3,
    duration: 60,
  })
  async strict() {
    return this.rateLimitDemo.strictStore();
  }
}
