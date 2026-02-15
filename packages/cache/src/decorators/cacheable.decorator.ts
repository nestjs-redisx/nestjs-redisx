/**
 * @Cacheable decorator for automatic method result caching.
 *
 * Caches method results and returns cached value on subsequent calls.
 * Supports key templates with parameter interpolation.
 *
 * @example
 * ```typescript
 * class UserService {
 *   @Cacheable({
 *     key: 'user:{id}',
 *     ttl: 3600,
 *     tags: ['users']
 *   })
 *   async getUser(id: string) {
 *     return this.repository.findById(id);
 *   }
 *
 *   @Cacheable({
 *     key: 'user:{userId}:posts:{postId}',
 *     ttl: 1800
 *   })
 *   async getUserPost(userId: string, postId: string) {
 *     return this.repository.findPost(userId, postId);
 *   }
 * }
 * ```
 */

import { SetMetadata } from '@nestjs/common';

/**
 * Options for @Cacheable decorator.
 */
export interface ICacheableOptions {
  /**
   * Cache key template. Supports parameter interpolation.
   * Use {paramName} to interpolate method parameters.
   *
   * @example 'user:{id}'
   * @example 'post:{userId}:{postId}'
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
}

/**
 * Metadata key for @Cacheable decorator.
 */
export const CACHEABLE_METADATA_KEY = 'cache:cacheable';

/**
 * @Cacheable decorator.
 *
 * Automatically caches method results using the configured key template.
 * Supports parameter interpolation in key templates.
 *
 * @param options - Caching options
 *
 * @example
 * ```typescript
 * @Cacheable({ key: 'user:{id}', ttl: 3600 })
 * async getUser(id: string) {
 *   return await this.repository.findById(id);
 * }
 * ```
 */
export function Cacheable(options: ICacheableOptions): MethodDecorator {
  return SetMetadata(CACHEABLE_METADATA_KEY, options);
}
