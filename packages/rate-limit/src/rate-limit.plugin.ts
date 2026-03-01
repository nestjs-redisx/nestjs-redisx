/**
 * Rate limiting plugin for NestJS RedisX.
 * Provides multiple algorithms: fixed-window, sliding-window, token-bucket.
 */

import { DynamicModule, ForwardReference, Provider, Type } from '@nestjs/common';
import { APP_FILTER, Reflector } from '@nestjs/core';
import { IRedisXPlugin, IPluginAsyncOptions, CLIENT_MANAGER, RedisClientManager } from '@nestjs-redisx/core';

import { version } from '../package.json';
import { RateLimitExceptionFilter } from './rate-limit/api/filters/rate-limit-exception.filter';
import { RateLimitGuard } from './rate-limit/api/guards/rate-limit.guard';
import { RateLimitService } from './rate-limit/application/services/rate-limit.service';
import { RedisRateLimitStoreAdapter } from './rate-limit/infrastructure/adapters/redis-rate-limit-store.adapter';
import { RATE_LIMIT_PLUGIN_OPTIONS, RATE_LIMIT_REDIS_DRIVER, RATE_LIMIT_SERVICE, RATE_LIMIT_STORE } from './shared/constants';
import { IRateLimitPluginOptions } from './shared/types';

const DEFAULT_RATE_LIMIT_CONFIG: Required<Omit<IRateLimitPluginOptions, 'isGlobal' | 'client' | 'skip' | 'errorFactory'>> = {
  defaultAlgorithm: 'sliding-window',
  defaultPoints: 100,
  defaultDuration: 60,
  keyPrefix: 'rl:',
  defaultKeyExtractor: 'ip',
  includeHeaders: true,
  headers: {
    limit: 'X-RateLimit-Limit',
    remaining: 'X-RateLimit-Remaining',
    reset: 'X-RateLimit-Reset',
    retryAfter: 'Retry-After',
  },
  errorPolicy: 'fail-closed',
};

/**
 * Rate limiting plugin for NestJS RedisX.
 *
 * Provides rate limiting with multiple algorithms:
 * - Fixed Window
 * - Sliding Window
 * - Token Bucket
 *
 * @example
 * ```typescript
 * @Module({
 *   imports: [
 *     RedisModule.forRoot({
 *       clients: { host: 'localhost', port: 6379 },
 *       plugins: [
 *         new RateLimitPlugin({
 *           defaultAlgorithm: 'sliding-window',
 *           defaultPoints: 100,
 *           defaultDuration: 60,
 *           includeHeaders: true,
 *         }),
 *       ],
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
export class RateLimitPlugin implements IRedisXPlugin {
  readonly name = 'rate-limit';
  readonly version: string = version;
  readonly description = 'Rate limiting with fixed-window, sliding-window, and token-bucket algorithms';

  private asyncOptions?: IPluginAsyncOptions<IRateLimitPluginOptions>;

  constructor(private readonly options: IRateLimitPluginOptions = {}) {}

  static registerAsync(asyncOptions: IPluginAsyncOptions<IRateLimitPluginOptions>): RateLimitPlugin {
    const plugin = new RateLimitPlugin();
    plugin.asyncOptions = asyncOptions;
    return plugin;
  }

  private static mergeDefaults(options: IRateLimitPluginOptions): IRateLimitPluginOptions {
    return {
      client: options.client,
      defaultAlgorithm: options.defaultAlgorithm ?? DEFAULT_RATE_LIMIT_CONFIG.defaultAlgorithm,
      defaultPoints: options.defaultPoints ?? DEFAULT_RATE_LIMIT_CONFIG.defaultPoints,
      defaultDuration: options.defaultDuration ?? DEFAULT_RATE_LIMIT_CONFIG.defaultDuration,
      keyPrefix: options.keyPrefix ?? DEFAULT_RATE_LIMIT_CONFIG.keyPrefix,
      defaultKeyExtractor: options.defaultKeyExtractor ?? DEFAULT_RATE_LIMIT_CONFIG.defaultKeyExtractor,
      includeHeaders: options.includeHeaders ?? DEFAULT_RATE_LIMIT_CONFIG.includeHeaders,
      headers: { ...DEFAULT_RATE_LIMIT_CONFIG.headers, ...options.headers },
      errorPolicy: options.errorPolicy ?? DEFAULT_RATE_LIMIT_CONFIG.errorPolicy,
      skip: options.skip,
      errorFactory: options.errorFactory,
    };
  }

  getImports(): Array<Type<unknown> | DynamicModule | ForwardReference> {
    return this.asyncOptions?.imports ?? [];
  }

  getProviders(): Provider[] {
    const optionsProvider: Provider = this.asyncOptions
      ? {
          provide: RATE_LIMIT_PLUGIN_OPTIONS,
          useFactory: async (...args: unknown[]) => {
            const userOptions = await this.asyncOptions!.useFactory(...args);
            return RateLimitPlugin.mergeDefaults(userOptions);
          },
          inject: this.asyncOptions.inject || [],
        }
      : {
          provide: RATE_LIMIT_PLUGIN_OPTIONS,
          useValue: RateLimitPlugin.mergeDefaults(this.options),
        };

    return [
      optionsProvider,
      // Plugin-specific Redis driver (resolves named client)
      {
        provide: RATE_LIMIT_REDIS_DRIVER,
        useFactory: async (manager: RedisClientManager, options: IRateLimitPluginOptions) => {
          return await manager.getClient(options.client ?? 'default');
        },
        inject: [CLIENT_MANAGER, RATE_LIMIT_PLUGIN_OPTIONS],
      },
      { provide: RATE_LIMIT_STORE, useClass: RedisRateLimitStoreAdapter },
      { provide: RATE_LIMIT_SERVICE, useClass: RateLimitService },
      // Reflector is needed for @RateLimit decorator metadata
      Reflector,
      // Guard must be in providers for proper DI
      RateLimitGuard,
      // Global exception filter to return 429 instead of 500
      { provide: APP_FILTER, useClass: RateLimitExceptionFilter },
    ];
  }

  getExports(): Array<string | symbol | Provider> {
    return [RATE_LIMIT_PLUGIN_OPTIONS, RATE_LIMIT_SERVICE, RateLimitGuard];
  }
}
