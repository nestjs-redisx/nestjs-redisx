/**
 * @CacheEvict decorator for cache invalidation.
 *
 * Evicts (removes) cache entries after method execution.
 * Supports multiple keys, tags, and patterns.
 *
 * @example
 * ```typescript
 * class UserService {
 *   @CacheEvict({
 *     keys: ['user:{id}'],
 *     tags: ['users']
 *   })
 *   async updateUser(id: string, data: UpdateUserDto) {
 *     return this.repository.update(id, data);
 *   }
 *
 *   @CacheEvict({
 *     keys: ['user:{userId}:posts:*'],
 *     beforeInvocation: false
 *   })
 *   async deleteUserPosts(userId: string) {
 *     return this.repository.deletePosts(userId);
 *   }
 * }
 * ```
 */

import { SetMetadata } from '@nestjs/common';

/**
 * Options for @CacheEvict decorator.
 */
export interface ICacheEvictOptions {
  /**
   * Cache keys or key templates to evict.
   * Supports parameter interpolation and wildcards.
   *
   * @example ['user:{id}']
   * @example ['user:{userId}:posts:*']
   */
  keys?: string[];

  /**
   * Tags to invalidate.
   * All keys with these tags will be evicted.
   */
  tags?: string[];

  /**
   * Whether to evict all cache entries.
   * Use with caution - this clears the entire cache.
   *
   * @default false
   */
  allEntries?: boolean;

  /**
   * Whether to evict cache before method invocation.
   * - true: evict before execution
   * - false: evict after execution (default)
   *
   * @default false
   */
  beforeInvocation?: boolean;

  /**
   * Condition to determine if cache should be evicted.
   * Return false to skip eviction for specific cases.
   */
  condition?: (...args: unknown[]) => boolean;

  /**
   * Custom key generator function.
   * If provided, overrides template-based key generation.
   */
  keyGenerator?: (...args: unknown[]) => string[];

  /**
   * Namespace prefix for the keys.
   * @default ''
   */
  namespace?: string;
}

/**
 * Metadata key for @CacheEvict decorator.
 */
export const CACHE_EVICT_METADATA_KEY = 'cache:evict';

/**
 * @CacheEvict decorator.
 *
 * Automatically evicts cache entries after (or before) method execution.
 * Supports multiple keys, tags, and pattern matching.
 *
 * @param options - Eviction options
 *
 * @example
 * ```typescript
 * @CacheEvict({ keys: ['user:{id}'], tags: ['users'] })
 * async updateUser(id: string, data: UpdateUserDto) {
 *   return await this.repository.update(id, data);
 * }
 * ```
 */
export function CacheEvict(options: ICacheEvictOptions = {}): MethodDecorator {
  return SetMetadata(CACHE_EVICT_METADATA_KEY, options);
}
