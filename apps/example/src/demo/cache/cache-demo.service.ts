/**
 * @fileoverview Service demonstrating caching capabilities.
 *
 * Shows:
 * - Using the @Cached decorator
 * - L1 + L2 two-level caching
 * - Stampede (thundering herd) protection
 * - Stale-While-Revalidate pattern
 * - Tag-based invalidation
 */

import { Injectable, Inject } from '@nestjs/common';
import {
  Cached,
  CACHE_SERVICE,
  type ICacheService,
} from '@nestjs-redisx/cache';

/** User interface */
export interface User {
  id: string;
  name: string;
  email: string;
}

/** Product interface */
export interface Product {
  id: string;
  name: string;
  price: number;
}

@Injectable()
export class CacheDemoService {
  /** Atomic counter: how many times the stampede loader actually executed */
  private stampedeLoaderCallCount = 0;

  /** Atomic counter: how many times the SWR loader actually executed */
  private swrLoaderCallCount = 0;

  constructor(
    @Inject(CACHE_SERVICE) private readonly cacheService: ICacheService,
  ) {}

  /**
   * Get a user with caching.
   *
   * First call loads from "DB" and caches for 1 hour.
   * Subsequent calls return data from cache.
   *
   * @param id - User identifier
   * @returns User object
   */
  @Cached({
    key: 'user:{0}',
    ttl: 3600,
    tags: (id: string) => [`user:${id}`, 'users'],
  })
  async getUser(id: string): Promise<User> {
    // Log to demonstrate this is a real DB request
    console.log(`[DB] Loading user ${id}...`);

    // Simulate DB delay
    await this.simulateDbDelay();

    return {
      id,
      name: `User ${id}`,
      email: `user${id}@example.com`,
    };
  }

  /**
   * Get products with L1+L2 caching.
   *
   * Demonstrates two-level caching:
   * - L1: fast in-memory cache
   * - L2: Redis cache
   *
   * @param category - Product category
   * @returns List of products
   */
  @Cached({
    key: 'products:{0}',
    ttl: 1800,
    tags: ['products'],
  })
  async getProducts(category: string): Promise<Product[]> {
    console.log(`[DB] Loading products for category ${category}...`);
    await this.simulateDbDelay();

    return [
      { id: '1', name: `${category} Product 1`, price: 99.99 },
      { id: '2', name: `${category} Product 2`, price: 149.99 },
      { id: '3', name: `${category} Product 3`, price: 199.99 },
    ];
  }

  /**
   * Expensive operation with Stampede protection.
   *
   * With concurrent requests only the first goes to DB,
   * the rest wait for the result.
   *
   * @param id - Identifier
   * @returns Operation result
   */
  @Cached({
    key: 'expensive:{0}',
    ttl: 300,
  })
  async expensiveOperation(
    id: string,
  ): Promise<{ id: string; result: number }> {
    console.log(`[DB] Executing expensive operation ${id}...`);
    await this.simulateDbDelay(2000);

    return {
      id,
      result: Math.random() * 1000,
    };
  }

  /**
   * Data with Stale-While-Revalidate.
   *
   * Returns stale data instantly,
   * revalidation happens in the background.
   *
   * @param id - Identifier
   * @returns Data with timestamp
   */
  @Cached({
    key: 'swr:{0}',
    ttl: 60,
  })
  async getSwrData(id: string): Promise<{ id: string; timestamp: number }> {
    console.log(`[DB] Loading SWR data ${id}...`);
    await this.simulateDbDelay();

    return {
      id,
      timestamp: Date.now(),
    };
  }

  /**
   * Get cache statistics.
   *
   * @returns Hit/miss statistics
   */
  async getStats() {
    const stats = await this.cacheService.getStats();
    return {
      l1: stats.l1,
      l2: stats.l2,
      stampedePrevented: stats.stampedePrevented,
      hitRate: {
        l1:
          stats.l1.hits + stats.l1.misses > 0
            ? (
                (stats.l1.hits / (stats.l1.hits + stats.l1.misses)) *
                100
              ).toFixed(2) + '%'
            : '0%',
        l2:
          stats.l2.hits + stats.l2.misses > 0
            ? (
                (stats.l2.hits / (stats.l2.hits + stats.l2.misses)) *
                100
              ).toFixed(2) + '%'
            : '0%',
      },
    };
  }

  /**
   * Invalidate cache by tag.
   *
   * @param tag - Tag to invalidate
   * @returns Number of invalidated keys
   */
  async invalidateByTag(tag: string) {
    const count = await this.cacheService.invalidateTags([tag]);
    return { tag, invalidated: count };
  }

  /**
   * Clear all cache.
   *
   * @returns Operation result
   */
  async clearAll() {
    await this.cacheService.clear();
    return { success: true, message: 'Cache cleared' };
  }

  /**
   * Get localized products (i18n).
   * Cache depends on the Accept-Language header.
   *
   * @returns Localized products
   */
  async getProductsI18n(): Promise<Product[]> {
    console.log('[DB] Loading localized products...');
    await this.simulateDbDelay();

    // In production this would load from DB based on locale
    return [
      { id: '1', name: 'Product 1', price: 99.99 },
      { id: '2', name: 'Product 2', price: 149.99 },
      { id: '3', name: 'Product 3', price: 199.99 },
    ];
  }

  /**
   * Get products for a specific tenant.
   * Cache depends on the X-Tenant-Id header.
   *
   * @returns Tenant's products
   */
  async getProductsTenant(): Promise<Product[]> {
    console.log("[DB] Loading tenant's products...");
    await this.simulateDbDelay();

    // In production this would filter by tenantId
    return [
      { id: '1', name: 'Tenant Product 1', price: 199.99 },
      { id: '2', name: 'Tenant Product 2', price: 299.99 },
    ];
  }

  /**
   * Update a user.
   * @CacheEvict decorator automatically invalidates the cache.
   *
   * @param id - User identifier
   * @param data - New data
   * @returns Updated user
   */
  async updateUser(id: string, data: Partial<User>): Promise<User> {
    console.log(`[DB] Updating user ${id}...`);
    await this.simulateDbDelay();

    // In production this would be an UPDATE in the DB
    return {
      id,
      name: data.name || `User ${id}`,
      email: data.email || `user${id}@example.com`,
    };
  }

  // ─── Stampede & SWR Verification ────────────────────────────────────

  /**
   * Reset stampede/SWR test state.
   * Clears cache keys and resets loader counters.
   */
  async resetStampedeTest(): Promise<{ success: true }> {
    this.stampedeLoaderCallCount = 0;
    this.swrLoaderCallCount = 0;
    await this.cacheService.delete('stampede-test:verify');
    await this.cacheService.delete('swr-test:verify');
    return { success: true };
  }

  /**
   * Stampede protection verification via @Cached.
   *
   * Uses a 2-second slow loader. When called concurrently,
   * only ONE loader should execute (stampedeLoaderCallCount === 1).
   * Without stampede protection, all concurrent callers would each
   * run the loader independently.
   */
  @Cached({
    key: 'stampede-test:verify',
    ttl: 30,
  })
  async stampedeTestLoad(): Promise<{
    loaderCallCount: number;
    loadedAt: number;
    pid: number;
  }> {
    this.stampedeLoaderCallCount++;
    const callNum = this.stampedeLoaderCallCount;
    console.log(`[STAMPEDE-TEST] Loader executing (call #${callNum})...`);

    // Slow loader — 2 seconds to simulate DB
    await new Promise((resolve) => setTimeout(resolve, 2000));

    console.log(`[STAMPEDE-TEST] Loader finished (call #${callNum})`);
    return {
      loaderCallCount: callNum,
      loadedAt: Date.now(),
      pid: process.pid,
    };
  }

  /**
   * Get current stampede loader call count (without going through cache).
   */
  getStampedeCallCount(): number {
    return this.stampedeLoaderCallCount;
  }

  /**
   * SWR verification via @Cached.
   *
   * Short TTL (5s) + staleTime (15s).
   * After TTL expires, stale data should be returned immediately
   * and revalidation should happen in background.
   */
  @Cached({
    key: 'swr-test:verify',
    ttl: 5,
    swr: { enabled: true, staleTime: 15 },
  })
  async swrTestLoad(): Promise<{
    loaderCallCount: number;
    loadedAt: number;
    timestamp: string;
  }> {
    this.swrLoaderCallCount++;
    const callNum = this.swrLoaderCallCount;
    console.log(`[SWR-TEST] Loader executing (call #${callNum})...`);

    // 1-second delay to make revalidation observable
    await new Promise((resolve) => setTimeout(resolve, 1000));

    console.log(`[SWR-TEST] Loader finished (call #${callNum})`);
    return {
      loaderCallCount: callNum,
      loadedAt: Date.now(),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get current SWR loader call count (without going through cache).
   */
  getSwrCallCount(): number {
    return this.swrLoaderCallCount;
  }

  // ─── Private ────────────────────────────────────────────────────────

  /**
   * Simulate DB delay.
   *
   * @param ms - Delay in milliseconds
   */
  private async simulateDbDelay(ms = 500): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
