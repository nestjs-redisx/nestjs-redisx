/**
 * Dedup plugin for NestJS RedisX.
 * Event deduplication (first-wins markers with TTL windows) and distributed
 * trailing debounce, with the @Dedupe decorator.
 */

import { DynamicModule, ForwardReference, Provider, Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IRedisXPlugin, IPluginAsyncOptions, CLIENT_MANAGER, REDIS_CLIENTS_INITIALIZATION, RedisClientManager } from '@nestjs-redisx/core';

import { version } from '../package.json';
import { DEDUP_PLUGIN_OPTIONS, DEDUP_REDIS_DRIVER, DEDUP_SERVICE, DEDUP_STORE, DEFAULT_DEDUP_CONFIG } from './shared/constants';
import { IDedupPluginOptions } from './shared/types';
import { validateDedupOptions } from './shared/utils/validate-dedup-options';
import { DedupDecoratorInitializerService } from './dedup/application/services/dedup-decorator-initializer.service';
import { DedupService } from './dedup/application/services/dedup.service';
import { RedisDedupStoreAdapter } from './dedup/infrastructure/adapters/redis-dedup-store.adapter';

/**
 * Event deduplication plugin for NestJS RedisX.
 *
 * Lightweight first-wins markers: "has this key been seen in the window?" —
 * run webhooks, queue messages, and user actions exactly once per window
 * across the fleet, plus a distributed trailing debounce. For request-grade
 * idempotency with fingerprints and response replay, use
 * `@nestjs-redisx/idempotency`.
 *
 * @example
 * ```typescript
 * @Module({
 *   imports: [
 *     RedisModule.forRoot({
 *       clients: { host: 'localhost', port: 6379 },
 *       plugins: [
 *         new DedupPlugin({ defaultWindow: 60000 }),
 *       ],
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
export class DedupPlugin implements IRedisXPlugin {
  readonly name = 'dedup';
  readonly version: string = version;
  readonly description = 'Event deduplication and distributed debounce with TTL windows';

  private asyncOptions?: IPluginAsyncOptions<IDedupPluginOptions>;

  constructor(private readonly options: IDedupPluginOptions = {}) {}

  static registerAsync(asyncOptions: IPluginAsyncOptions<IDedupPluginOptions>): DedupPlugin {
    const plugin = new DedupPlugin();
    plugin.asyncOptions = asyncOptions;
    return plugin;
  }

  private static mergeDefaults(options: IDedupPluginOptions): IDedupPluginOptions {
    const merged: IDedupPluginOptions = {
      client: options.client,
      keyPrefix: options.keyPrefix ?? DEFAULT_DEDUP_CONFIG.keyPrefix,
      defaultWindow: options.defaultWindow ?? DEFAULT_DEDUP_CONFIG.defaultWindow,
      errorPolicy: options.errorPolicy ?? DEFAULT_DEDUP_CONFIG.errorPolicy,
    };
    // Fail fast on BOTH the sync and registerAsync paths.
    validateDedupOptions(merged);
    return merged;
  }

  getImports(): Array<Type<unknown> | DynamicModule | ForwardReference> {
    return this.asyncOptions?.imports ?? [];
  }

  getProviders(): Provider[] {
    const optionsProvider: Provider = this.asyncOptions
      ? {
          provide: DEDUP_PLUGIN_OPTIONS,
          useFactory: async (...args: unknown[]) => {
            const userOptions = await this.asyncOptions!.useFactory(...args);
            return DedupPlugin.mergeDefaults(userOptions);
          },
          inject: this.asyncOptions.inject || [],
        }
      : {
          provide: DEDUP_PLUGIN_OPTIONS,
          useValue: DedupPlugin.mergeDefaults(this.options),
        };

    return [
      optionsProvider,

      // Plugin-specific Redis driver (resolves named client)
      {
        provide: DEDUP_REDIS_DRIVER,
        useFactory: async (manager: RedisClientManager, _init: void, options: IDedupPluginOptions) => {
          const clientName = options.client ?? 'default';
          try {
            return await manager.getClient(clientName);
          } catch {
            throw new Error(`DedupPlugin: Redis client "${clientName}" not found. ` + `Available clients are configured in RedisModule.forRoot({ clients: { ... } }). ` + `Either add a "${clientName}" client or remove the "client" option to use the default connection.`);
          }
        },
        inject: [CLIENT_MANAGER, REDIS_CLIENTS_INITIALIZATION, DEDUP_PLUGIN_OPTIONS],
      },

      // Store adapter
      {
        provide: DEDUP_STORE,
        useClass: RedisDedupStoreAdapter,
      },

      // Application service
      {
        provide: DEDUP_SERVICE,
        useClass: DedupService,
      },

      // @Dedupe decorator initialization (proxy-based)
      DedupDecoratorInitializerService,

      // Reflector is needed for decorator metadata
      Reflector,
    ];
  }

  getExports(): Array<string | symbol | Provider> {
    return [DEDUP_SERVICE];
  }
}
