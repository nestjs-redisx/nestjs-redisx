/**
 * @fileoverview Service demonstrating request rate limiting.
 *
 * Shows:
 * - Sliding window algorithm
 * - Fixed window algorithm
 * - Token bucket algorithm
 * - Rate limiting per IP and per user
 * - Getting limit status
 */

import { Injectable } from '@nestjs/common';

@Injectable()
export class RateLimitDemoService {
  /**
   * Public endpoint with rate limit per IP.
   *
   * Limit: 10 requests per minute.
   *
   * @returns Request information
   */
  async publicEndpoint() {
    return {
      message: 'Public endpoint accessed',
      timestamp: Date.now(),
      info: 'Rate limited to 10 requests per minute per IP',
    };
  }

  /**
   * Endpoint for authenticated users.
   *
   * Limit: 100 requests per minute per user.
   *
   * @param userId - User ID
   * @returns Request information
   */
  async authenticatedEndpoint(userId: string) {
    return {
      message: 'Authenticated endpoint accessed',
      userId,
      timestamp: Date.now(),
      info: 'Rate limited to 100 requests per minute per user',
    };
  }

  /**
   * Endpoint with sliding window algorithm.
   *
   * @returns Request information
   */
  async slidingWindow() {
    return {
      algorithm: 'sliding-window',
      message: 'Sliding window algorithm provides smooth rate limiting',
      timestamp: Date.now(),
    };
  }

  /**
   * Endpoint with fixed window algorithm.
   *
   * @returns Request information
   */
  async fixedWindow() {
    return {
      algorithm: 'fixed-window',
      message: 'Fixed window resets at fixed intervals',
      timestamp: Date.now(),
    };
  }

  /**
   * Endpoint with token bucket algorithm.
   *
   * @returns Request information
   */
  async tokenBucket() {
    return {
      algorithm: 'token-bucket',
      message: 'Token bucket allows bursts of traffic',
      timestamp: Date.now(),
    };
  }
}
