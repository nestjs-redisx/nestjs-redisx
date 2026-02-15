/**
 * Cache interceptor for handling @Cacheable, @CachePut, and @CacheEvict decorators.
 */

import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from, of } from 'rxjs';
import { switchMap, tap } from 'rxjs/operators';

import { CacheService } from '../cache.service';
import { ICacheEvictOptions, CACHE_EVICT_METADATA_KEY } from './cache-evict.decorator';
import { ICachePutOptions, CACHE_PUT_METADATA_KEY } from './cache-put.decorator';
import { ICacheableOptions, CACHEABLE_METADATA_KEY } from './cacheable.decorator';
import { generateKey, generateKeys, evaluateTags, evaluateCondition } from './key-generator.util';

/**
 * Interceptor for cache decorators.
 *
 * Handles:
 * - @Cacheable: Returns cached value or executes and caches result
 * - @CachePut: Always executes and caches result
 * - @CacheEvict: Evicts cache entries before or after execution
 *
 * @example
 * ```typescript
 * @Controller('users')
 * @UseInterceptors(CacheInterceptor)
 * export class UserController {
 *   @Get(':id')
 *   @Cacheable({ key: 'user:{id}', ttl: 3600 })
 *   getUser(@Param('id') id: string) {
 *     return this.userService.findOne(id);
 *   }
 *
 *   @Put(':id')
 *   @CachePut({ key: 'user:{id}' })
 *   updateUser(@Param('id') id: string, @Body() data: UpdateUserDto) {
 *     return this.userService.update(id, data);
 *   }
 *
 *   @Delete(':id')
 *   @CacheEvict({ keys: ['user:{id}'] })
 *   deleteUser(@Param('id') id: string) {
 *     return this.userService.delete(id);
 *   }
 * }
 * ```
 */
@Injectable()
export class CacheInterceptor implements NestInterceptor {
  private readonly logger = new Logger(CacheInterceptor.name);

  constructor(
    private readonly cacheService: CacheService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const handler = context.getHandler();
    const _target = context.getClass();

    // Get metadata from decorators
    const cacheableOptions = this.reflector.get<ICacheableOptions>(CACHEABLE_METADATA_KEY, handler);
    const cachePutOptions = this.reflector.get<ICachePutOptions>(CACHE_PUT_METADATA_KEY, handler);
    const cacheEvictOptions = this.reflector.get<ICacheEvictOptions>(CACHE_EVICT_METADATA_KEY, handler);

    // Get method arguments
    const args = context.getArgByIndex(context.getArgs().length - 1) ? context.getArgs() : [];

    const method = handler;

    // Handle @Cacheable
    if (cacheableOptions) {
      return this.handleCacheable(cacheableOptions, method, args, next);
    }

    // Handle @CachePut
    if (cachePutOptions) {
      return this.handleCachePut(cachePutOptions, method, args, next);
    }

    // Handle @CacheEvict
    if (cacheEvictOptions) {
      return this.handleCacheEvict(cacheEvictOptions, method, args, next);
    }

    // No cache decorator found, proceed normally
    return next.handle();
  }

  /**
   * Handles @Cacheable decorator.
   * Returns cached value or executes method and caches result.
   */
  private handleCacheable(
    options: ICacheableOptions,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    method: Function,
    args: unknown[],
    next: CallHandler,
  ): Observable<unknown> {
    // Check condition
    if (!evaluateCondition(options.condition, args)) {
      this.logger.debug('Cacheable condition not met, executing method');
      return next.handle();
    }

    try {
      // Generate cache key
      const key = options.keyGenerator ? options.keyGenerator(...args) : generateKey(options.key, method, args, options.namespace);

      this.logger.debug(`Cacheable: checking cache for key: ${key}`);

      // Try to get from cache
      return from(this.cacheService.get(key)).pipe(
        switchMap((cachedValue) => {
          if (cachedValue !== null) {
            this.logger.debug(`Cacheable: cache hit for key: ${key}`);
            return of(cachedValue);
          }

          this.logger.debug(`Cacheable: cache miss for key: ${key}, executing method`);

          // Cache miss - execute method
          return next.handle().pipe(
            // eslint-disable-next-line @typescript-eslint/no-misused-promises
            tap(async (result) => {
              // Cache the result
              const tags = evaluateTags(options.tags, args);
              const ttl = options.ttl ?? 3600;

              try {
                await this.cacheService.set(key, result, { ttl, tags });
                this.logger.debug(`Cacheable: cached result for key: ${key}`);
              } catch (error) {
                this.logger.error(`Cacheable: failed to cache result for key ${key}: ${(error as Error).message}`);
              }
            }),
          );
        }),
      );
    } catch (error) {
      this.logger.error(`Cacheable: error processing cache: ${(error as Error).message}`);
      return next.handle();
    }
  }

  /**
   * Handles @CachePut decorator.
   * Always executes method and caches the result.
   */
  private handleCachePut(
    options: ICachePutOptions,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    method: Function,
    args: unknown[],
    next: CallHandler,
  ): Observable<unknown> {
    // Check condition
    if (!evaluateCondition(options.condition, args)) {
      this.logger.debug('CachePut condition not met, executing method without caching');
      return next.handle();
    }

    try {
      // Generate cache key
      const key = options.keyGenerator ? options.keyGenerator(...args) : generateKey(options.key, method, args, options.namespace);

      this.logger.debug(`CachePut: executing method for key: ${key}`);

      // Execute method
      return next.handle().pipe(
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        tap(async (result) => {
          // Skip caching null/undefined if not allowed
          if ((result === null || result === undefined) && !options.cacheNullValues) {
            this.logger.debug(`CachePut: skipping null/undefined result for key: ${key}`);
            return;
          }

          // Cache the result
          const tags = evaluateTags(options.tags, args);
          const ttl = options.ttl ?? 3600;

          try {
            await this.cacheService.set(key, result, { ttl, tags });
            this.logger.debug(`CachePut: cached result for key: ${key}`);
          } catch (error) {
            this.logger.error(`CachePut: failed to cache result for key ${key}: ${(error as Error).message}`);
          }
        }),
      );
    } catch (error) {
      this.logger.error(`CachePut: error processing cache: ${(error as Error).message}`);
      return next.handle();
    }
  }

  /**
   * Handles @CacheEvict decorator.
   * Evicts cache entries before or after method execution.
   */
  private handleCacheEvict(
    options: ICacheEvictOptions,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    method: Function,
    args: unknown[],
    next: CallHandler,
  ): Observable<unknown> {
    // Check condition
    if (!evaluateCondition(options.condition, args)) {
      this.logger.debug('CacheEvict condition not met, executing method without eviction');
      return next.handle();
    }

    const evictFn = async () => {
      try {
        // Handle allEntries flag
        if (options.allEntries) {
          this.logger.debug('CacheEvict: clearing all cache entries');
          await this.cacheService.clear();
          return;
        }

        // Handle tag-based eviction
        if (options.tags && options.tags.length > 0) {
          this.logger.debug(`CacheEvict: invalidating tags: ${options.tags.join(', ')}`);
          await this.cacheService.invalidateTags(options.tags);
        }

        // Handle key-based eviction
        if (options.keys && options.keys.length > 0) {
          const keys = options.keyGenerator ? options.keyGenerator(...args) : generateKeys(options.keys, method, args, options.namespace);

          this.logger.debug(`CacheEvict: evicting keys: ${keys.join(', ')}`);

          for (const key of keys) {
            // Check if key contains wildcard
            if (key.includes('*')) {
              // Pattern-based invalidation not directly supported
              // Would need to scan all keys or use tags
              this.logger.warn(`CacheEvict: wildcard keys not supported: ${key}. Use tags instead.`);
            } else {
              await this.cacheService.del(key);
            }
          }
        }
      } catch (error) {
        this.logger.error(`CacheEvict: error evicting cache: ${(error as Error).message}`);
      }
    };

    // Evict before invocation
    if (options.beforeInvocation) {
      return from(evictFn()).pipe(switchMap(() => next.handle()));
    }

    // Evict after invocation (default)
    return next.handle().pipe(
      tap(() => {
        void evictFn();
      }),
    );
  }
}
