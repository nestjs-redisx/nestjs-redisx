/**
 * Session plugin for NestJS RedisX.
 * Redis session store for express-session / @fastify/session plus a service
 * with per-user introspection, revocation, seat limits, and an absolute
 * lifetime cap.
 */

import { DynamicModule, ForwardReference, Provider, Type } from '@nestjs/common';
import { IRedisXPlugin, IPluginAsyncOptions, CLIENT_MANAGER, REDIS_CLIENTS_INITIALIZATION, RedisClientManager } from '@nestjs-redisx/core';

import { version } from '../package.json';
import { SessionService } from './session/application/services/session.service';
import { defaultUserIdExtractor } from './session/domain/session-metadata';
import { validateSessionConfig } from './session/domain/validate-session-config';
import { RedisSessionStoreAdapter } from './session/infrastructure/adapters/redis-session-store.adapter';
import { SESSION_PLUGIN_OPTIONS, SESSION_REDIS_DRIVER, SESSION_SERVICE, SESSION_STORE, DEFAULT_SESSION_CONFIG } from './shared/constants';
import { ISessionPluginOptions } from './shared/types';

/**
 * Session plugin for NestJS RedisX.
 *
 * The base layer is a store for the session middleware you already run
 * (`express-session` / `@fastify/session` via `toExpressStore` /
 * `toFastifyStore`); cookie handling, session fixation defense, and ID
 * rotation stay with the middleware. On top of the same keys,
 * `SESSION_SERVICE` adds what the Store contract cannot: the per-user device
 * page, `revokeAllExcept`, seat limits, and the absolute lifetime cap.
 *
 * @example
 * ```typescript
 * @Module({
 *   imports: [
 *     RedisModule.forRoot({
 *       clients: { host: 'localhost', port: 6379 },
 *       plugins: [
 *         new SessionPlugin({
 *           absoluteLifetimeMs: 12 * 3600 * 1000,
 *           maxSessionsPerUser: 5,
 *         }),
 *       ],
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
export class SessionPlugin implements IRedisXPlugin {
  readonly name = 'session';
  readonly version: string = version;
  readonly description = 'Redis session store for express-session/@fastify/session with per-user introspection, revocation, seat limits, and absolute lifetime caps';

  private asyncOptions?: IPluginAsyncOptions<ISessionPluginOptions>;

  constructor(private readonly options: ISessionPluginOptions = {}) {}

  static registerAsync(asyncOptions: IPluginAsyncOptions<ISessionPluginOptions>): SessionPlugin {
    const plugin = new SessionPlugin();
    plugin.asyncOptions = asyncOptions;
    return plugin;
  }

  private static mergeDefaults(options: ISessionPluginOptions): ISessionPluginOptions {
    const merged: ISessionPluginOptions = {
      isGlobal: options.isGlobal,
      client: options.client,
      keyPrefix: options.keyPrefix ?? DEFAULT_SESSION_CONFIG.keyPrefix,
      defaultTtlMs: options.defaultTtlMs ?? DEFAULT_SESSION_CONFIG.defaultTtlMs,
      userIdExtractor: options.userIdExtractor ?? defaultUserIdExtractor,
      absoluteLifetimeMs: options.absoluteLifetimeMs,
      maxSessionsPerUser: options.maxSessionsPerUser,
      maxSessionsPolicy: options.maxSessionsPolicy ?? DEFAULT_SESSION_CONFIG.maxSessionsPolicy,
      events: options.events,
    };

    // Fail fast at bootstrap: an invalid config must never reach the store.
    validateSessionConfig({
      keyPrefix: merged.keyPrefix!,
      defaultTtlMs: merged.defaultTtlMs!,
      absoluteLifetimeMs: merged.absoluteLifetimeMs,
      maxSessionsPerUser: merged.maxSessionsPerUser,
      maxSessionsPolicy: merged.maxSessionsPolicy!,
      userIdExtractor: merged.userIdExtractor!,
    });

    return merged;
  }

  getImports(): Array<Type<unknown> | DynamicModule | ForwardReference> {
    return this.asyncOptions?.imports ?? [];
  }

  getProviders(): Provider[] {
    const optionsProvider: Provider = this.asyncOptions
      ? {
          provide: SESSION_PLUGIN_OPTIONS,
          useFactory: async (...args: unknown[]) => {
            const userOptions = await this.asyncOptions!.useFactory(...args);
            return SessionPlugin.mergeDefaults(userOptions);
          },
          inject: this.asyncOptions.inject || [],
        }
      : {
          provide: SESSION_PLUGIN_OPTIONS,
          useValue: SessionPlugin.mergeDefaults(this.options),
        };

    return [
      optionsProvider,

      // Plugin-specific Redis driver (resolves named client)
      {
        provide: SESSION_REDIS_DRIVER,
        useFactory: async (manager: RedisClientManager, _init: void, options: ISessionPluginOptions) => {
          const clientName = options.client ?? 'default';
          try {
            return await manager.getClient(clientName);
          } catch {
            throw new Error(`SessionPlugin: Redis client "${clientName}" not found. ` + `Available clients are configured in RedisModule.forRoot({ clients: { ... } }). ` + `Either add a "${clientName}" client or remove the "client" option to use the default connection.`);
          }
        },
        inject: [CLIENT_MANAGER, REDIS_CLIENTS_INITIALIZATION, SESSION_PLUGIN_OPTIONS],
      },

      // Store adapter (also consumed by the middleware store factories)
      {
        provide: SESSION_STORE,
        useClass: RedisSessionStoreAdapter,
      },

      // Application service
      {
        provide: SESSION_SERVICE,
        useClass: SessionService,
      },
    ];
  }

  getExports(): Array<string | symbol | Provider> {
    return [SESSION_SERVICE, SESSION_STORE];
  }
}
