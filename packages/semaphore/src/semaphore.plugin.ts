/**
 * Semaphore plugin for NestJS RedisX.
 * Distributed counting semaphore: bound concurrency across instances with
 * permit leases, auto-renewal, and the @WithSemaphore decorator.
 */

import { DynamicModule, ForwardReference, Provider, Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IRedisXPlugin, IPluginAsyncOptions, CLIENT_MANAGER, REDIS_CLIENTS_INITIALIZATION, RedisClientManager } from '@nestjs-redisx/core';

import { version } from '../package.json';
import { SEMAPHORE_PLUGIN_OPTIONS, SEMAPHORE_REDIS_DRIVER, SEMAPHORE_SERVICE, SEMAPHORE_STORE, DEFAULT_SEMAPHORE_CONFIG } from './shared/constants';
import { ISemaphorePluginOptions } from './shared/types';
import { validateSemaphoreOptions } from './shared/utils/validate-semaphore-options';
import { SemaphoreDecoratorInitializerService } from './semaphore/application/services/semaphore-decorator-initializer.service';
import { SemaphoreService } from './semaphore/application/services/semaphore.service';
import { RedisSemaphoreStoreAdapter } from './semaphore/infrastructure/adapters/redis-semaphore-store.adapter';

/**
 * Distributed counting semaphore plugin for NestJS RedisX.
 *
 * At most N concurrent holders of a key across the whole fleet — the
 * distributed analogue of a bounded worker pool. Permits are leases: a
 * crashed holder frees its seat after the TTL, and auto-renewal keeps
 * long-running work seated.
 *
 * @example
 * ```typescript
 * @Module({
 *   imports: [
 *     RedisModule.forRoot({
 *       clients: { host: 'localhost', port: 6379 },
 *       plugins: [
 *         new SemaphorePlugin({
 *           defaultTtl: 30000,
 *           keyPrefix: '_sem:',
 *         }),
 *       ],
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
export class SemaphorePlugin implements IRedisXPlugin {
  readonly name = 'semaphore';
  readonly version: string = version;
  readonly description = 'Distributed counting semaphore with permit leases and auto-renewal';

  private asyncOptions?: IPluginAsyncOptions<ISemaphorePluginOptions>;

  constructor(private readonly options: ISemaphorePluginOptions = {}) {}

  static registerAsync(asyncOptions: IPluginAsyncOptions<ISemaphorePluginOptions>): SemaphorePlugin {
    const plugin = new SemaphorePlugin();
    plugin.asyncOptions = asyncOptions;
    return plugin;
  }

  private static mergeDefaults(options: ISemaphorePluginOptions): ISemaphorePluginOptions {
    const merged: ISemaphorePluginOptions = {
      client: options.client,
      keyPrefix: options.keyPrefix ?? DEFAULT_SEMAPHORE_CONFIG.keyPrefix,
      defaultTtl: options.defaultTtl ?? DEFAULT_SEMAPHORE_CONFIG.defaultTtl,
      maxTtl: options.maxTtl ?? DEFAULT_SEMAPHORE_CONFIG.maxTtl,
      retry: { ...DEFAULT_SEMAPHORE_CONFIG.retry, ...options.retry },
      autoRenew: { ...DEFAULT_SEMAPHORE_CONFIG.autoRenew, ...options.autoRenew },
    };
    // Fail fast on BOTH the sync and registerAsync paths.
    validateSemaphoreOptions(merged);
    return merged;
  }

  getImports(): Array<Type<unknown> | DynamicModule | ForwardReference> {
    return this.asyncOptions?.imports ?? [];
  }

  getProviders(): Provider[] {
    const optionsProvider: Provider = this.asyncOptions
      ? {
          provide: SEMAPHORE_PLUGIN_OPTIONS,
          useFactory: async (...args: unknown[]) => {
            const userOptions = await this.asyncOptions!.useFactory(...args);
            return SemaphorePlugin.mergeDefaults(userOptions);
          },
          inject: this.asyncOptions.inject || [],
        }
      : {
          provide: SEMAPHORE_PLUGIN_OPTIONS,
          useValue: SemaphorePlugin.mergeDefaults(this.options),
        };

    return [
      optionsProvider,

      // Plugin-specific Redis driver (resolves named client)
      {
        provide: SEMAPHORE_REDIS_DRIVER,
        useFactory: async (manager: RedisClientManager, _init: void, options: ISemaphorePluginOptions) => {
          const clientName = options.client ?? 'default';
          try {
            return await manager.getClient(clientName);
          } catch {
            throw new Error(`SemaphorePlugin: Redis client "${clientName}" not found. ` + `Available clients are configured in RedisModule.forRoot({ clients: { ... } }). ` + `Either add a "${clientName}" client or remove the "client" option to use the default connection.`);
          }
        },
        inject: [CLIENT_MANAGER, REDIS_CLIENTS_INITIALIZATION, SEMAPHORE_PLUGIN_OPTIONS],
      },

      // Store adapter
      {
        provide: SEMAPHORE_STORE,
        useClass: RedisSemaphoreStoreAdapter,
      },

      // Application service
      {
        provide: SEMAPHORE_SERVICE,
        useClass: SemaphoreService,
      },

      // @WithSemaphore decorator initialization (proxy-based)
      SemaphoreDecoratorInitializerService,

      // Reflector is needed for decorator metadata
      Reflector,
    ];
  }

  getExports(): Array<string | symbol | Provider> {
    return [SEMAPHORE_SERVICE];
  }
}
