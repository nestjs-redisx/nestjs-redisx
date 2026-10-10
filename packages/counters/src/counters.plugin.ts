/**
 * Counters plugin for NestJS RedisX.
 * Fleet-wide atomic counters, window counters with first-write TTL, and
 * monotonic ID sequences.
 */

import { DynamicModule, ForwardReference, Provider, Type } from '@nestjs/common';
import { IRedisXPlugin, IPluginAsyncOptions, CLIENT_MANAGER, REDIS_CLIENTS_INITIALIZATION, RedisClientManager } from '@nestjs-redisx/core';

import { version } from '../package.json';
import { COUNTERS_PLUGIN_OPTIONS, COUNTERS_REDIS_DRIVER, COUNTER_SERVICE, COUNTER_STORE, DEFAULT_COUNTERS_CONFIG } from './shared/constants';
import { ICountersPluginOptions } from './shared/types';
import { validateCountersOptions } from './shared/utils/validate-counter-options';
import { CounterService } from './counter/application/services/counter.service';
import { RedisCounterStoreAdapter } from './counter/infrastructure/adapters/redis-counter-store.adapter';

/**
 * Atomic counters plugin for NestJS RedisX.
 *
 * Concurrent increments from any number of instances never lose updates:
 * page views, API usage, quotas, live statistics, batch totals
 * (getAndReset), window counters that expire on their own, and monotonic
 * sequences for fleet-wide ID generation.
 *
 * @example
 * ```typescript
 * @Module({
 *   imports: [
 *     RedisModule.forRoot({
 *       clients: { host: 'localhost', port: 6379 },
 *       plugins: [new CountersPlugin()],
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
export class CountersPlugin implements IRedisXPlugin {
  readonly name = 'counters';
  readonly version: string = version;
  readonly description = 'Atomic counters, window counters, and monotonic sequences';

  private asyncOptions?: IPluginAsyncOptions<ICountersPluginOptions>;

  constructor(private readonly options: ICountersPluginOptions = {}) {}

  static registerAsync(asyncOptions: IPluginAsyncOptions<ICountersPluginOptions>): CountersPlugin {
    const plugin = new CountersPlugin();
    plugin.asyncOptions = asyncOptions;
    return plugin;
  }

  private static mergeDefaults(options: ICountersPluginOptions): ICountersPluginOptions {
    const merged: ICountersPluginOptions = {
      client: options.client,
      keyPrefix: options.keyPrefix ?? DEFAULT_COUNTERS_CONFIG.keyPrefix,
    };
    // Fail fast on BOTH the sync and registerAsync paths.
    validateCountersOptions(merged);
    return merged;
  }

  getImports(): Array<Type<unknown> | DynamicModule | ForwardReference> {
    return this.asyncOptions?.imports ?? [];
  }

  getProviders(): Provider[] {
    const optionsProvider: Provider = this.asyncOptions
      ? {
          provide: COUNTERS_PLUGIN_OPTIONS,
          useFactory: async (...args: unknown[]) => {
            const userOptions = await this.asyncOptions!.useFactory(...args);
            return CountersPlugin.mergeDefaults(userOptions);
          },
          inject: this.asyncOptions.inject || [],
        }
      : {
          provide: COUNTERS_PLUGIN_OPTIONS,
          useValue: CountersPlugin.mergeDefaults(this.options),
        };

    return [
      optionsProvider,

      // Plugin-specific Redis driver (resolves named client)
      {
        provide: COUNTERS_REDIS_DRIVER,
        useFactory: async (manager: RedisClientManager, _init: void, options: ICountersPluginOptions) => {
          const clientName = options.client ?? 'default';
          try {
            return await manager.getClient(clientName);
          } catch {
            throw new Error(`CountersPlugin: Redis client "${clientName}" not found. ` + `Available clients are configured in RedisModule.forRoot({ clients: { ... } }). ` + `Either add a "${clientName}" client or remove the "client" option to use the default connection.`);
          }
        },
        inject: [CLIENT_MANAGER, REDIS_CLIENTS_INITIALIZATION, COUNTERS_PLUGIN_OPTIONS],
      },

      // Store adapter
      {
        provide: COUNTER_STORE,
        useClass: RedisCounterStoreAdapter,
      },

      // Application service
      {
        provide: COUNTER_SERVICE,
        useClass: CounterService,
      },
    ];
  }

  getExports(): Array<string | symbol | Provider> {
    return [COUNTER_SERVICE];
  }
}
