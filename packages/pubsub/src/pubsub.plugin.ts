/**
 * Redis Pub/Sub plugin for NestJS RedisX.
 * Typed publish/subscribe with pattern support, a @Subscribe decorator with
 * auto-discovery, and a dedicated subscriber connection.
 */

import { DynamicModule, ForwardReference, Provider, Type } from '@nestjs/common';
import { DiscoveryModule, Reflector } from '@nestjs/core';
import { IRedisXPlugin, IPluginAsyncOptions, CLIENT_MANAGER, REDIS_CLIENTS_INITIALIZATION, RedisClientManager, DriverType } from '@nestjs-redisx/core';

import { version } from '../package.json';
import { PubSubDiscovery } from './pubsub/api/discovery/pubsub.discovery';
import { PubSubService } from './pubsub/application/services/pubsub.service';
import { PUBSUB_PLUGIN_OPTIONS, PUBSUB_PUBLISHER_DRIVER, PUBSUB_SERVICE, PUBSUB_SUBSCRIBER_DRIVER, DEFAULT_PUBSUB_CONFIG } from './shared/constants';
import { IPubSubPluginOptions } from './shared/types';

/**
 * Redis Pub/Sub plugin for NestJS RedisX.
 *
 * @example
 * ```typescript
 * @Module({
 *   imports: [
 *     RedisModule.forRoot({
 *       clients: { host: 'localhost', port: 6379 },
 *       plugins: [new PubSubPlugin({ channelPrefix: 'app:' })],
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
export class PubSubPlugin implements IRedisXPlugin {
  readonly name = 'pubsub';
  readonly version: string = version;
  readonly description = 'Typed Redis Pub/Sub with pattern subscriptions, @Subscribe auto-discovery, and a dedicated subscriber connection';

  private asyncOptions?: IPluginAsyncOptions<IPubSubPluginOptions>;

  constructor(private readonly options: IPubSubPluginOptions = {}) {}

  static registerAsync(asyncOptions: IPluginAsyncOptions<IPubSubPluginOptions>): PubSubPlugin {
    const plugin = new PubSubPlugin();
    plugin.asyncOptions = asyncOptions;
    return plugin;
  }

  private static mergeDefaults(options: IPubSubPluginOptions): IPubSubPluginOptions {
    return {
      client: options.client,
      channelPrefix: options.channelPrefix ?? DEFAULT_PUBSUB_CONFIG.channelPrefix,
    };
  }

  getImports(): Array<Type<unknown> | DynamicModule | ForwardReference> {
    // DiscoveryModule powers the @Subscribe decorator scan.
    return [DiscoveryModule, ...(this.asyncOptions?.imports ?? [])];
  }

  getProviders(): Provider[] {
    const optionsProvider: Provider = this.asyncOptions
      ? {
          provide: PUBSUB_PLUGIN_OPTIONS,
          useFactory: async (...args: unknown[]) => {
            const userOptions = await this.asyncOptions!.useFactory(...args);
            return PubSubPlugin.mergeDefaults(userOptions);
          },
          inject: this.asyncOptions.inject || [],
        }
      : {
          provide: PUBSUB_PLUGIN_OPTIONS,
          useValue: PubSubPlugin.mergeDefaults(this.options),
        };

    return [
      optionsProvider,

      // Publisher: the plugin's named client (regular command connection).
      {
        provide: PUBSUB_PUBLISHER_DRIVER,
        useFactory: async (manager: RedisClientManager, _init: void, options: IPubSubPluginOptions) => {
          const clientName = options.client ?? 'default';
          try {
            return await manager.getClient(clientName);
          } catch {
            throw new Error(`PubSubPlugin: Redis client "${clientName}" not found. ` + `Available clients are configured in RedisModule.forRoot({ clients: { ... } }). ` + `Either add a "${clientName}" client or remove the "client" option to use the default connection.`);
          }
        },
        inject: [CLIENT_MANAGER, REDIS_CLIENTS_INITIALIZATION, PUBSUB_PLUGIN_OPTIONS],
      },

      // Subscriber: a DEDICATED connection cloned from the named client's
      // config — a Redis connection in subscriber mode cannot execute regular
      // commands, so subscriptions must never share the publisher connection.
      {
        provide: PUBSUB_SUBSCRIBER_DRIVER,
        useFactory: async (manager: RedisClientManager, _init: void, options: IPubSubPluginOptions) => {
          const clientName = options.client ?? 'default';
          // Ensure the base client exists (throws a clear error otherwise).
          await manager.getClient(clientName);

          const subscriberName = `${clientName}:pubsub-subscriber`;
          if (!manager.hasClient(subscriberName)) {
            // Clone connection config AND driver type (e.g. the in-memory
            // driver in tests) from the base client.
            const { config, driverType } = manager.getMetadata(clientName);
            await manager.createClient(subscriberName, config, { driverType: driverType as DriverType | undefined });
          }
          return manager.getClient(subscriberName);
        },
        inject: [CLIENT_MANAGER, REDIS_CLIENTS_INITIALIZATION, PUBSUB_PLUGIN_OPTIONS],
      },

      // Application service
      {
        provide: PUBSUB_SERVICE,
        useClass: PubSubService,
      },

      // @Subscribe auto-discovery
      PubSubDiscovery,

      // Reflector is needed for decorator metadata
      Reflector,
    ];
  }

  getExports(): Array<string | symbol | Provider> {
    return [PUBSUB_SERVICE];
  }
}
