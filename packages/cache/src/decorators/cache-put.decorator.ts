/**
 * @CachePut decorator for cache updates.
 *
 * Always executes the method and updates the cache with the result.
 * Unlike @Cacheable, it doesn't check the cache before execution.
 *
 * @example
 * ```typescript
 * class UserService {
 *   @CachePut({
 *     key: 'user:{id}',
 *     tags: ['users']
 *   })
 *   async updateUser(id: string, data: UpdateUserDto) {
 *     const updated = await this.repository.update(id, data);
 *     return updated; // This result will be cached
 *   }
 *
 *   @CachePut({
 *     key: 'user:{user.id}',
 *     ttl: 1800
 *   })
 *   async createUser(user: CreateUserDto) {
 *     const created = await this.repository.create(user);
 *     return created; // This result will be cached
 *   }
 * }
 * ```
 */

import { SetMetadata } from '@nestjs/common';

/**
 * Options for @CachePut decorator.
 */
export interface ICachePutOptions {
  /**
   * Cache key template. Supports parameter interpolation.
   * Use {paramName} to interpolate method parameters.
   * Supports nested properties: {user.id}
   *
   * @example 'user:{id}'
   * @example 'user:{user.id}'
   */
  key: string;

  /**
   * TTL in seconds.
   * @default 3600
   */
  ttl?: number;

  /**
   * Tags for invalidation.
   * Can be static array or function that returns array.
   */
  tags?: string[] | ((...args: unknown[]) => string[]);

  /**
   * Condition to determine if result should be cached.
   * Return false to skip caching for specific cases.
   */
  condition?: (...args: unknown[]) => boolean;

  /**
   * Custom key generator function.
   * If provided, overrides template-based key generation.
   */
  keyGenerator?: (...args: unknown[]) => string;

  /**
   * Namespace prefix for the key.
   * @default ''
   */
  namespace?: string;

  /**
   * Whether to cache null/undefined results.
   * @default false
   */
  cacheNullValues?: boolean;
}

/**
 * Metadata key for @CachePut decorator.
 */
export const CACHE_PUT_METADATA_KEY = 'cache:put';

/**
 * @CachePut decorator.
 *
 * Always executes the method and caches the result.
 * Useful for update operations where you want to refresh the cache.
 *
 * @param options - Cache put options
 *
 * @example
 * ```typescript
 * @CachePut({ key: 'user:{id}', ttl: 3600 })
 * async updateUser(id: string, data: UpdateUserDto) {
 *   return await this.repository.update(id, data);
 * }
 * ```
 */
export function CachePut(options: ICachePutOptions): MethodDecorator {
  return SetMetadata(CACHE_PUT_METADATA_KEY, options);
}
