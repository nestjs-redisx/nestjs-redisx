/**
 * Locks plugin for NestJS RedisX.
 * Provides distributed locking with auto-renewal and retry strategies.
 */

import { DynamicModule, ForwardReference, Provider, Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IRedisXPlugin, IPluginAsyncOptions } from '@nestjs-redisx/core';

import { LOCKS_PLUGIN_OPTIONS, LOCK_SERVICE, LOCK_STORE } from './shared/constants';
import { ILocksPluginOptions } from './shared/types';
import { LockDecoratorInitializerService } from './lock/application/services/lock-decorator-initializer.service';
import { LockService } from './lock/application/services/lock.service';
import { RedisLockStoreAdapter } from './lock/infrastructure/adapters/redis-lock-store.adapter';

const DEFAULT_LOCKS_CONFIG: Required<Omit<ILocksPluginOptions, 'isGlobal'>> = {
  defaultTtl: 30000,
  maxTtl: 300000,
  keyPrefix: '_lock:',
  retry: {
    maxRetries: 3,
    initialDelay: 100,
    maxDelay: 3000,
    multiplier: 2,
  },
  autoRenew: {
    enabled: true,
    intervalFraction: 0.5,
  },
};

/**
 * Distributed locks plugin for NestJS RedisX.
 *
 * Provides distributed locking with auto-renewal and retry strategies.
 *
 * @example
 * ```typescript
 * @Module({
 *   imports: [
 *     RedisModule.forRoot({
 *       clients: { host: 'localhost', port: 6379 },
 *       plugins: [
 *         new LocksPlugin({
 *           defaultTtl: 30000,
 *           keyPrefix: '_lock:',
 *           autoRenew: { enabled: true },
 *         }),
 *       ],
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
export class LocksPlugin implements IRedisXPlugin {
  readonly name = 'locks';
  readonly version = '0.1.0';
  readonly description = 'Distributed locking with auto-renewal and retry strategies';

  private asyncOptions?: IPluginAsyncOptions<ILocksPluginOptions>;

  constructor(private readonly options: ILocksPluginOptions = {}) {}

  static registerAsync(asyncOptions: IPluginAsyncOptions<ILocksPluginOptions>): LocksPlugin {
    const plugin = new LocksPlugin();
    plugin.asyncOptions = asyncOptions;
    return plugin;
  }

  private static mergeDefaults(options: ILocksPluginOptions): ILocksPluginOptions {
    return {
      defaultTtl: options.defaultTtl ?? DEFAULT_LOCKS_CONFIG.defaultTtl,
      maxTtl: options.maxTtl ?? DEFAULT_LOCKS_CONFIG.maxTtl,
      keyPrefix: options.keyPrefix ?? DEFAULT_LOCKS_CONFIG.keyPrefix,
      retry: { ...DEFAULT_LOCKS_CONFIG.retry, ...options.retry },
      autoRenew: { ...DEFAULT_LOCKS_CONFIG.autoRenew, ...options.autoRenew },
    };
  }

  getImports(): Array<Type<unknown> | DynamicModule | ForwardReference> {
    return this.asyncOptions?.imports ?? [];
  }

  getProviders(): Provider[] {
    const optionsProvider: Provider = this.asyncOptions
      ? {
          provide: LOCKS_PLUGIN_OPTIONS,
          useFactory: async (...args: unknown[]) => {
            const userOptions = await this.asyncOptions!.useFactory(...args);
            return LocksPlugin.mergeDefaults(userOptions);
          },
          inject: this.asyncOptions.inject || [],
        }
      : {
          provide: LOCKS_PLUGIN_OPTIONS,
          useValue: LocksPlugin.mergeDefaults(this.options),
        };

    return [
      optionsProvider,

      // Store adapter
      {
        provide: LOCK_STORE,
        useClass: RedisLockStoreAdapter,
      },

      // Application service
      {
        provide: LOCK_SERVICE,
        useClass: LockService,
      },

      // @WithLock decorator initialization (proxy-based)
      LockDecoratorInitializerService,

      // Reflector is needed for decorator metadata
      Reflector,
    ];
  }

  getExports(): Array<string | symbol | Provider> {
    return [LOCK_SERVICE];
  }
}
