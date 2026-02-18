/**
 * @fileoverview Controller demonstrating caching.
 *
 * Endpoints:
 * - GET /demo/cache/user/:id - User caching
 * - GET /demo/cache/products/:category - L1+L2 caching
 * - GET /demo/cache/expensive/:id - Stampede protection
 * - GET /demo/cache/swr/:id - Stale-While-Revalidate
 * - GET /demo/cache/stats - Cache statistics
 * - POST /demo/cache/invalidate - Tag-based invalidation
 * - DELETE /demo/cache/clear - Clear cache
 */

import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Cached, CacheEvict } from '@nestjs-redisx/cache';
import { CacheDemoService } from './cache-demo.service';

@Controller('demo/cache')
export class CacheDemoController {
  constructor(private readonly cacheDemo: CacheDemoService) {}

  /**
   * Simple test endpoint.
   *
   * @example
   * ```bash
   * curl http://localhost:3000/demo/cache/test
   * ```
   */
  @Get('test')
  async test() {
    return {
      status: 'ok',
      plugin: 'cache',
      message: 'Cache plugin is working',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get a user with caching.
   *
   * @example
   * ```bash
   * # First request - goes to DB
   * curl http://localhost:3000/demo/cache/user/123
   *
   * # Second request - from cache
   * curl http://localhost:3000/demo/cache/user/123
   * ```
   */
  @Get('user/:id')
  async getUser(@Param('id') id: string) {
    return this.cacheDemo.getUser(id);
  }

  /**
   * Get products with L1+L2 caching.
   *
   * @example
   * ```bash
   * curl http://localhost:3000/demo/cache/products/electronics
   * ```
   */
  @Get('products/:category')
  async getProducts(@Param('category') category: string) {
    return this.cacheDemo.getProducts(category);
  }

  /**
   * Expensive operation with Stampede protection.
   *
   * Try making several concurrent requests:
   *
   * @example
   * ```bash
   * # Run simultaneously in several terminals
   * for i in {1..5}; do
   *   curl http://localhost:3000/demo/cache/expensive/test &
   * done
   * wait
   *
   * # Only the first request will go to DB
   * ```
   */
  @Get('expensive/:id')
  async expensive(@Param('id') id: string) {
    return this.cacheDemo.expensiveOperation(id);
  }

  /**
   * Stale-While-Revalidate demo.
   *
   * @example
   * ```bash
   * # First request
   * curl http://localhost:3000/demo/cache/swr/test
   *
   * # Wait 35 seconds (longer than staleTime)
   * sleep 35
   *
   * # Second request returns stale data instantly,
   * # revalidation happens in the background
   * curl http://localhost:3000/demo/cache/swr/test
   * ```
   */
  @Get('swr/:id')
  async swr(@Param('id') id: string) {
    return this.cacheDemo.getSwrData(id);
  }

  /**
   * Get cache statistics.
   *
   * @example
   * ```bash
   * curl http://localhost:3000/demo/cache/stats
   * ```
   */
  @Get('stats')
  async stats() {
    return this.cacheDemo.getStats();
  }

  /**
   * Invalidate cache by tag.
   *
   * @example
   * ```bash
   * # Invalidate all entries with tag "users"
   * curl -X POST http://localhost:3000/demo/cache/invalidate \
   *   -H "Content-Type: application/json" \
   *   -d '{"tag": "users"}'
   * ```
   */
  @Post('invalidate')
  @HttpCode(HttpStatus.OK)
  async invalidate(@Body() body: { tag: string }) {
    return this.cacheDemo.invalidateByTag(body.tag);
  }

  /**
   * varyBy demo for i18n.
   * Different languages - different caches.
   *
   * @example
   * ```bash
   * # English
   * curl http://localhost:3000/demo/cache/i18n/products \
   *   -H "Accept-Language: en-US"
   *
   * # Russian (different cache)
   * curl http://localhost:3000/demo/cache/i18n/products \
   *   -H "Accept-Language: ru-RU"
   * ```
   */
  @Get('i18n/products')
  @Cached({
    key: 'products:list:i18n',
    ttl: 3600,
    varyBy: ['accept-language'],
  })
  async getProductsI18n() {
    return this.cacheDemo.getProductsI18n();
  }

  /**
   * varyBy demo for multi-tenant.
   * Different tenants - different caches.
   *
   * @example
   * ```bash
   * # Tenant 1
   * curl http://localhost:3000/demo/cache/tenant/products \
   *   -H "X-Tenant-Id: tenant-1"
   *
   * # Tenant 2 (different cache)
   * curl http://localhost:3000/demo/cache/tenant/products \
   *   -H "X-Tenant-Id: tenant-2"
   * ```
   */
  @Get('tenant/products')
  @Cached({
    key: 'products:list:tenant',
    ttl: 3600,
    varyBy: ['x-tenant-id'],
  })
  async getProductsTenant() {
    return this.cacheDemo.getProductsTenant();
  }

  /**
   * Update a user and invalidate cache.
   * @CacheEvict decorator demo.
   *
   * @example
   * ```bash
   * # First cache the user
   * curl http://localhost:3000/demo/cache/user/123
   *
   * # Update them (invalidates cache)
   * curl -X POST http://localhost:3000/demo/cache/user/123 \
   *   -H "Content-Type: application/json" \
   *   -d '{"name": "Updated User", "email": "updated@example.com"}'
   *
   * # Verify that the cache was cleared
   * curl http://localhost:3000/demo/cache/user/123
   * ```
   */
  @Post('user/:id')
  @HttpCode(HttpStatus.OK)
  @CacheEvict({
    keys: ['user:{0}'],
    tags: ['users'],
  })
  async updateUser(@Param('id') id: string, @Body() data: any) {
    return this.cacheDemo.updateUser(id, data);
  }

  /**
   * Clear all cache.
   *
   * @example
   * ```bash
   * curl -X DELETE http://localhost:3000/demo/cache/clear
   * ```
   */
  @Delete('clear')
  async clear() {
    return this.cacheDemo.clearAll();
  }

  // ─── Stampede & SWR Verification Endpoints ──────────────────────────

  /**
   * Reset stampede/SWR test state (clear cache + counters).
   *
   * @example
   * ```bash
   * curl -X POST http://localhost:3000/demo/cache/verify/reset
   * ```
   */
  @Post('verify/reset')
  @HttpCode(HttpStatus.OK)
  async verifyReset() {
    return this.cacheDemo.resetStampedeTest();
  }

  /**
   * Stampede protection verification.
   *
   * Has a 2-second slow loader. Fire 10 concurrent requests —
   * loader should execute exactly ONCE.
   *
   * @example
   * ```bash
   * # Reset first
   * curl -X POST http://localhost:3000/demo/cache/verify/reset
   *
   * # Fire 10 concurrent requests
   * for i in $(seq 1 10); do
   *   curl -s http://localhost:3000/demo/cache/verify/stampede &
   * done
   * wait
   *
   * # Check count — should be 1
   * curl http://localhost:3000/demo/cache/verify/stampede/count
   * ```
   */
  @Get('verify/stampede')
  async verifyStampede() {
    return this.cacheDemo.stampedeTestLoad();
  }

  /**
   * Get stampede loader call count (bypasses cache).
   */
  @Get('verify/stampede/count')
  async verifyStampedeCount() {
    return {
      loaderCallCount: this.cacheDemo.getStampedeCallCount(),
      expected: 1,
      pass: this.cacheDemo.getStampedeCallCount() === 1,
    };
  }

  /**
   * SWR verification via @Cached.
   *
   * TTL=5s, staleTime=15s. After 6s, returns stale data instantly
   * and revalidates in background.
   *
   * @example
   * ```bash
   * # Reset
   * curl -X POST http://localhost:3000/demo/cache/verify/reset
   *
   * # 1) Populate cache (loader call #1)
   * curl http://localhost:3000/demo/cache/verify/swr
   *
   * # 2) Wait for TTL to expire (6 seconds)
   * sleep 6
   *
   * # 3) Should return STALE data instantly + trigger background revalidation
   * curl http://localhost:3000/demo/cache/verify/swr
   *
   * # 4) Wait for revalidation to complete (2 seconds)
   * sleep 2
   *
   * # 5) Should return FRESH data from revalidation (loader call #2)
   * curl http://localhost:3000/demo/cache/verify/swr
   *
   * # Check count — should be 2 (initial + 1 revalidation)
   * curl http://localhost:3000/demo/cache/verify/swr/count
   * ```
   */
  @Get('verify/swr')
  async verifySwr() {
    return this.cacheDemo.swrTestLoad();
  }

  /**
   * Get SWR loader call count (bypasses cache).
   */
  @Get('verify/swr/count')
  async verifySwrCount() {
    return {
      loaderCallCount: this.cacheDemo.getSwrCallCount(),
    };
  }
}
