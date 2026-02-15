/**
 * Main cache service.
 * Simplified API wrapper over the internal cache implementation.
 */

import { Injectable, Inject } from '@nestjs/common';

import { ICacheService as IInternalCacheService } from './cache/application/ports/cache-service.port';
import { CACHE_SERVICE } from './shared/constants';
import { CacheSetOptions, CacheGetOrSetOptions, CacheStats } from './shared/types';

@Injectable()
export class CacheService {
  constructor(
    @Inject(CACHE_SERVICE)
    private readonly internalCache: IInternalCacheService,
  ) {}

  /**
   * Gets value from cache.
   *
   * @param key - Cache key
   * @returns Cached value or null if not found
   *
   * @example
   * ```typescript
   * const user = await cacheService.get<User>('user:123');
   * ```
   */
  async get<T>(key: string): Promise<T | null> {
    return this.internalCache.get<T>(key);
  }

  /**
   * Sets value in cache with optional TTL and tags.
   *
   * @param key - Cache key
   * @param value - Value to cache
   * @param options - Cache options (ttl, tags, strategy)
   *
   * @example
   * ```typescript
   * await cacheService.set('user:123', user, {
   *   ttl: 3600,
   *   tags: ['users', 'user:123']
   * });
   * ```
   */
  async set<T>(key: string, value: T, options?: CacheSetOptions): Promise<void> {
    return this.internalCache.set(key, value, options);
  }

  /**
   * Deletes key from cache.
   *
   * @param key - Cache key
   * @returns True if key was deleted, false if not found
   *
   * @example
   * ```typescript
   * const deleted = await cacheService.del('user:123');
   * ```
   */
  async del(key: string): Promise<boolean> {
    return this.internalCache.delete(key);
  }

  /**
   * Gets multiple values from cache.
   *
   * @param keys - Array of cache keys
   * @returns Array of values (null for missing keys)
   *
   * @example
   * ```typescript
   * const users = await cacheService.getMany<User>(['user:1', 'user:2', 'user:3']);
   * ```
   */
  async getMany<T>(keys: string[]): Promise<Array<T | null>> {
    return this.internalCache.getMany<T>(keys);
  }

  /**
   * Sets multiple values in cache.
   *
   * @param entries - Array of key-value-ttl tuples
   *
   * @example
   * ```typescript
   * await cacheService.setMany([
   *   { key: 'user:1', value: user1, ttl: 3600 },
   *   { key: 'user:2', value: user2, ttl: 3600 }
   * ]);
   * ```
   */
  async setMany<T>(entries: Array<{ key: string; value: T; ttl?: number }>): Promise<void> {
    return this.internalCache.setMany(entries);
  }

  /**
   * Gets value from cache or loads it using the provided loader function.
   * Implements cache-aside pattern with anti-stampede protection.
   *
   * @param key - Cache key
   * @param loader - Function to load value if not cached
   * @param options - Cache options
   * @returns Cached or loaded value
   *
   * @example
   * ```typescript
   * const user = await cacheService.getOrSet(
   *   'user:123',
   *   async () => {
   *     return await userRepository.findById('123');
   *   },
   *   { ttl: 3600, tags: ['users'] }
   * );
   * ```
   */
  async getOrSet<T>(key: string, loader: () => Promise<T>, options?: CacheGetOrSetOptions): Promise<T> {
    return this.internalCache.getOrSet(key, loader, options);
  }

  /**
   * Wraps a function with caching logic.
   * Helper for creating cached functions.
   *
   * @param fn - Function to wrap
   * @param options - Cache options or key builder function
   * @returns Wrapped function with caching
   *
   * @example
   * ```typescript
   * const getCachedUser = cacheService.wrap(
   *   async (id: string) => userRepository.findById(id),
   *   {
   *     key: (id: string) => `user:${id}`,
   *     ttl: 3600,
   *     tags: (id: string) => [`user:${id}`, 'users']
   *   }
   * );
   *
   * const user = await getCachedUser('123');
   * ```
   */
  wrap<TArgs extends unknown[], TReturn>(
    fn: (...args: TArgs) => Promise<TReturn>,
    options: {
      key: (...args: TArgs) => string;
      ttl?: number;
      tags?: string[] | ((...args: TArgs) => string[]);
    },
  ): (...args: TArgs) => Promise<TReturn> {
    return async (...args: TArgs): Promise<TReturn> => {
      const key = options.key(...args);
      const tags = typeof options.tags === 'function' ? options.tags(...args) : options.tags;

      return this.getOrSet(key, () => fn(...args), {
        ttl: options.ttl,
        tags,
      });
    };
  }

  /**
   * Deletes multiple keys from cache.
   *
   * @param keys - Array of cache keys
   * @returns Number of keys deleted
   *
   * @example
   * ```typescript
   * const count = await cacheService.deleteMany(['user:1', 'user:2', 'user:3']);
   * console.log(`Deleted ${count} keys`);
   * ```
   */
  async deleteMany(keys: string[]): Promise<number> {
    return this.internalCache.deleteMany(keys);
  }

  /**
   * Gets all cache keys associated with a tag.
   *
   * @param tag - Tag name
   * @returns Array of cache keys
   *
   * @example
   * ```typescript
   * const keys = await cacheService.getKeysByTag('users');
   * console.log(`Found ${keys.length} cached user keys`);
   * ```
   */
  async getKeysByTag(tag: string): Promise<string[]> {
    return this.internalCache.getKeysByTag(tag);
  }

  /**
   * Invalidates cache by tag.
   *
   * @param tag - Tag to invalidate
   * @returns Number of keys invalidated
   *
   * @example
   * ```typescript
   * // Invalidate all user caches
   * const count = await cacheService.invalidate('users');
   * console.log(`Invalidated ${count} keys`);
   * ```
   */
  async invalidate(tag: string): Promise<number> {
    return this.internalCache.invalidateTag(tag);
  }

  /**
   * Invalidates multiple tags.
   *
   * @param tags - Array of tags to invalidate
   * @returns Total number of keys invalidated
   *
   * @example
   * ```typescript
   * const count = await cacheService.invalidate(['users', 'products']);
   * ```
   */
  async invalidateTags(tags: string[]): Promise<number> {
    return this.internalCache.invalidateTags(tags);
  }

  /**
   * Invalidates cache keys matching a pattern.
   * Uses Redis SCAN for safe iteration.
   *
   * @param pattern - Redis pattern (supports * and ?)
   * @returns Number of keys deleted
   *
   * @example
   * ```typescript
   * // Delete all user-related caches
   * await cacheService.invalidateByPattern('user:*');
   *
   * // Delete specific locale caches
   * await cacheService.invalidateByPattern('*:en_US');
   * ```
   */
  async invalidateByPattern(pattern: string): Promise<number> {
    return this.internalCache.invalidateByPattern(pattern);
  }

  /**
   * Checks if key exists in cache.
   *
   * @param key - Cache key
   * @returns True if key exists
   */
  async has(key: string): Promise<boolean> {
    return this.internalCache.has(key);
  }

  /**
   * Gets TTL for a cached key.
   *
   * @param key - Cache key
   * @returns TTL in seconds, -1 if no TTL, -2 if key doesn't exist
   */
  async ttl(key: string): Promise<number> {
    return this.internalCache.ttl(key);
  }

  /**
   * Clears all cache entries.
   * Use with caution in production.
   *
   * @example
   * ```typescript
   * await cacheService.clear();
   * ```
   */
  async clear(): Promise<void> {
    return this.internalCache.clear();
  }

  /**
   * Gets cache statistics.
   *
   * @returns Cache stats (hits, misses, size)
   *
   * @example
   * ```typescript
   * const stats = await cacheService.getStats();
   * console.log(`L1 Hit Rate: ${stats.l1.hits / (stats.l1.hits + stats.l1.misses) * 100}%`);
   * ```
   */
  async getStats(): Promise<CacheStats> {
    return this.internalCache.getStats();
  }
}
