/**
 * Leader election plugin for NestJS RedisX.
 * Run cron jobs, migrations, and cleanup on exactly one instance of the
 * fleet, with lease heartbeats and automatic failover.
 */

import { DynamicModule, ForwardReference, Provider, Type } from '@nestjs/common';
import { IRedisXPlugin, IPluginAsyncOptions, CLIENT_MANAGER, ErrorCode, REDIS_CLIENTS_INITIALIZATION, RedisClientManager, RedisXError } from '@nestjs-redisx/core';

import { version } from '../package.json';
import { LeaderDecoratorInitializerService } from './leader/application/services/leader-decorator-initializer.service';
import { LeaderService } from './leader/application/services/leader.service';
import { RedisLeaderStoreAdapter } from './leader/infrastructure/adapters/redis-leader-store.adapter';
import { DEFAULT_LEADER_CONFIG, LEADER_PLUGIN_OPTIONS, LEADER_REDIS_DRIVER, LEADER_SERVICE, LEADER_STORE } from './shared/constants';
import { InvalidLeaderConfigError } from './shared/errors';
import { ILeaderPluginOptions } from './shared/types';
import { validateLeaderOptions } from './shared/utils/validate-leader-options';

/**
 * Leader election plugin.
 *
 * @example
 * ```typescript
 * @Module({
 *   imports: [
 *     RedisModule.forRoot({
 *       clients: { host: 'localhost', port: 6379 },
 *       plugins: [
 *         new LeaderPlugin({
 *           ttlMs: 15000,
 *           onElected: (group) => console.log(`now leading ${group}`),
 *         }),
 *       ],
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
export class LeaderPlugin implements IRedisXPlugin {
  readonly name = 'leader';
  readonly version: string = version;
  readonly description = 'Leader election with lease heartbeats and automatic failover - run singleton work on exactly one instance';

  private asyncOptions?: IPluginAsyncOptions<ILeaderPluginOptions>;

  constructor(private readonly options: ILeaderPluginOptions = {}) {}

  static registerAsync(asyncOptions: IPluginAsyncOptions<ILeaderPluginOptions>): LeaderPlugin {
    if (!asyncOptions || typeof asyncOptions.useFactory !== 'function') {
      // A falsy argument (misspelled config import resolving to undefined)
      // would silently select the SYNC branch with all-defaults options -
      // dropping groups and the onElected/onLost callbacks with zero
      // signal, against the documented never-masked fail-fast contract.
      throw new InvalidLeaderConfigError(`LeaderPlugin.registerAsync: asyncOptions with a "useFactory" function is required, got ${asyncOptions === null ? 'null' : typeof asyncOptions}.`);
    }
    const plugin = new LeaderPlugin();
    plugin.asyncOptions = asyncOptions;
    return plugin;
  }

  private static mergeDefaults(options: ILeaderPluginOptions): ILeaderPluginOptions {
    // Fail-fast validation (sync AND async construction paths).
    validateLeaderOptions(options, 'LeaderPlugin options');

    return {
      client: options.client,
      keyPrefix: options.keyPrefix ?? DEFAULT_LEADER_CONFIG.keyPrefix,
      ttlMs: options.ttlMs ?? DEFAULT_LEADER_CONFIG.ttlMs,
      renewIntervalMs: options.renewIntervalMs ?? DEFAULT_LEADER_CONFIG.renewIntervalMs,
      retryIntervalMs: options.retryIntervalMs ?? DEFAULT_LEADER_CONFIG.retryIntervalMs,
      // Copy: a caller mutating its array after registration must not change
      // which elections start at bootstrap.
      groups: [...(options.groups ?? DEFAULT_LEADER_CONFIG.groups)],
      instanceId: options.instanceId,
      onElected: options.onElected,
      onLost: options.onLost,
    };
  }

  getImports(): Array<Type<unknown> | DynamicModule | ForwardReference> {
    return this.asyncOptions?.imports ?? [];
  }

  getProviders(): Provider[] {
    const optionsProvider: Provider = this.asyncOptions
      ? {
          provide: LEADER_PLUGIN_OPTIONS,
          useFactory: async (...args: unknown[]) => {
            const userOptions = await this.asyncOptions!.useFactory(...args);
            return LeaderPlugin.mergeDefaults(userOptions);
          },
          inject: this.asyncOptions.inject || [],
        }
      : {
          provide: LEADER_PLUGIN_OPTIONS,
          useValue: LeaderPlugin.mergeDefaults(this.options),
        };

    return [
      optionsProvider,
      // Plugin-specific Redis driver (resolves named client)
      {
        provide: LEADER_REDIS_DRIVER,
        useFactory: async (manager: RedisClientManager, _init: void, options: ILeaderPluginOptions) => {
          const clientName = options.client ?? 'default';
          try {
            return await manager.getClient(clientName);
          } catch (error) {
            // Only an actually-missing client is a configuration mistake;
            // everything else (lazy connect failing, manager shutting down)
            // must surface with its REAL cause - rewriting ECONNREFUSED into
            // "add a client" advice sends the operator to the wrong place.
            if (error instanceof RedisXError && error.code === ErrorCode.CFG_INVALID) {
              throw new InvalidLeaderConfigError(`LeaderPlugin: Redis client "${clientName}" not found. ` + `Available clients are configured in RedisModule.forRoot({ clients: { ... } }). ` + `Either add a "${clientName}" client or remove the "client" option to use the default connection.`);
            }
            throw error;
          }
        },
        inject: [CLIENT_MANAGER, REDIS_CLIENTS_INITIALIZATION, LEADER_PLUGIN_OPTIONS],
      },
      { provide: LEADER_STORE, useClass: RedisLeaderStoreAdapter },
      { provide: LEADER_SERVICE, useClass: LeaderService },
      LeaderDecoratorInitializerService,
    ];
  }

  getExports(): Array<string | symbol | Provider> {
    return [LEADER_PLUGIN_OPTIONS, LEADER_SERVICE];
  }
}
