/**
 * Idempotency plugin for NestJS RedisX.
 * Provides request deduplication with response replay for idempotent operations.
 */

import { DynamicModule, ForwardReference, Provider, Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IRedisXPlugin, IPluginAsyncOptions, CLIENT_MANAGER, REDIS_CLIENTS_INITIALIZATION, RedisClientManager } from '@nestjs-redisx/core';

import { version } from '../package.json';
import { IdempotencyInterceptor } from './idempotency/api/interceptors/idempotency.interceptor';
import { IdempotencyService } from './idempotency/application/services/idempotency.service';
import { RedisIdempotencyStoreAdapter } from './idempotency/infrastructure/adapters/redis-idempotency-store.adapter';
import { IDEMPOTENCY_PLUGIN_OPTIONS, IDEMPOTENCY_REDIS_DRIVER, IDEMPOTENCY_SERVICE, IDEMPOTENCY_STORE } from './shared/constants';
import { IIdempotencyPluginOptions } from './shared/types';

const DEFAULT_IDEMPOTENCY_CONFIG: Required<Omit<IIdempotencyPluginOptions, 'isGlobal' | 'client' | 'fingerprintGenerator'>> = {
  defaultTtl: 86400,
  keyPrefix: 'idempotency:',
  headerName: 'Idempotency-Key',
  lockTimeout: 30000,
  waitTimeout: 60000,
  validateFingerprint: true,
  fingerprintFields: ['method', 'path', 'body'],
  errorPolicy: 'fail-closed',
};

/**
 * Idempotency plugin for NestJS RedisX.
 *
 * Provides request deduplication with response replay:
 * - Prevents duplicate processing of same request
 * - Replays successful responses
 * - Handles concurrent requests
 * - Validates request fingerprints
 *
 * @example
 * ```typescript
 * @Module({
 *   imports: [
 *     RedisModule.forRoot({
 *       clients: { host: 'localhost', port: 6379 },
 *       plugins: [
 *         new IdempotencyPlugin({
 *           defaultTtl: 86400,
 *           headerName: 'Idempotency-Key',
 *           validateFingerprint: true,
 *         }),
 *       ],
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
export class IdempotencyPlugin implements IRedisXPlugin {
  readonly name = 'idempotency';
  readonly version: string = version;
  readonly description = 'Request deduplication with response replay for idempotent operations';

  private asyncOptions?: IPluginAsyncOptions<IIdempotencyPluginOptions>;

  constructor(private readonly options: IIdempotencyPluginOptions = {}) {}

  static registerAsync(asyncOptions: IPluginAsyncOptions<IIdempotencyPluginOptions>): IdempotencyPlugin {
    const plugin = new IdempotencyPlugin();
    plugin.asyncOptions = asyncOptions;
    return plugin;
  }

  private static mergeDefaults(options: IIdempotencyPluginOptions): IIdempotencyPluginOptions {
    return {
      client: options.client,
      defaultTtl: options.defaultTtl ?? DEFAULT_IDEMPOTENCY_CONFIG.defaultTtl,
      keyPrefix: options.keyPrefix ?? DEFAULT_IDEMPOTENCY_CONFIG.keyPrefix,
      headerName: options.headerName ?? DEFAULT_IDEMPOTENCY_CONFIG.headerName,
      lockTimeout: options.lockTimeout ?? DEFAULT_IDEMPOTENCY_CONFIG.lockTimeout,
      waitTimeout: options.waitTimeout ?? DEFAULT_IDEMPOTENCY_CONFIG.waitTimeout,
      validateFingerprint: options.validateFingerprint ?? DEFAULT_IDEMPOTENCY_CONFIG.validateFingerprint,
      fingerprintFields: options.fingerprintFields ?? DEFAULT_IDEMPOTENCY_CONFIG.fingerprintFields,
      errorPolicy: options.errorPolicy ?? DEFAULT_IDEMPOTENCY_CONFIG.errorPolicy,
      fingerprintGenerator: options.fingerprintGenerator,
    };
  }

  getImports(): Array<Type<unknown> | DynamicModule | ForwardReference> {
    return this.asyncOptions?.imports ?? [];
  }

  getProviders(): Provider[] {
    const optionsProvider: Provider = this.asyncOptions
      ? {
          provide: IDEMPOTENCY_PLUGIN_OPTIONS,
          useFactory: async (...args: unknown[]) => {
            const userOptions = await this.asyncOptions!.useFactory(...args);
            return IdempotencyPlugin.mergeDefaults(userOptions);
          },
          inject: this.asyncOptions.inject || [],
        }
      : {
          provide: IDEMPOTENCY_PLUGIN_OPTIONS,
          useValue: IdempotencyPlugin.mergeDefaults(this.options),
        };

    return [
      optionsProvider,
      // Plugin-specific Redis driver (resolves named client)
      {
        provide: IDEMPOTENCY_REDIS_DRIVER,
        useFactory: async (manager: RedisClientManager, _init: void, options: IIdempotencyPluginOptions) => {
          const clientName = options.client ?? 'default';
          try {
            return await manager.getClient(clientName);
          } catch (error) {
            throw new Error(`IdempotencyPlugin: Redis client "${clientName}" not found. ` + `Available clients are configured in RedisModule.forRoot({ clients: { ... } }). ` + `Either add a "${clientName}" client or remove the "client" option to use the default connection.`);
          }
        },
        inject: [CLIENT_MANAGER, REDIS_CLIENTS_INITIALIZATION, IDEMPOTENCY_PLUGIN_OPTIONS],
      },
      { provide: IDEMPOTENCY_STORE, useClass: RedisIdempotencyStoreAdapter },
      { provide: IDEMPOTENCY_SERVICE, useClass: IdempotencyService },
      // Reflector is needed for @Idempotent decorator metadata
      Reflector,
      IdempotencyInterceptor,
    ];
  }

  getExports(): Array<string | symbol | Provider> {
    return [IDEMPOTENCY_PLUGIN_OPTIONS, IDEMPOTENCY_SERVICE, IdempotencyInterceptor];
  }
}
