/**
 * Locks plugin for NestJS RedisX.
 * Provides distributed locking with auto-renewal and retry strategies.
 */

import { Provider } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IRedisXPlugin } from '@nestjs-redisx/core';

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

  constructor(private readonly options: ILocksPluginOptions = {}) {}

  getProviders(): Provider[] {
    // Merge user options with defaults
    const config: ILocksPluginOptions = {
      defaultTtl: this.options.defaultTtl ?? DEFAULT_LOCKS_CONFIG.defaultTtl,
      maxTtl: this.options.maxTtl ?? DEFAULT_LOCKS_CONFIG.maxTtl,
      keyPrefix: this.options.keyPrefix ?? DEFAULT_LOCKS_CONFIG.keyPrefix,
      retry: {
        ...DEFAULT_LOCKS_CONFIG.retry,
        ...this.options.retry,
      },
      autoRenew: {
        ...DEFAULT_LOCKS_CONFIG.autoRenew,
        ...this.options.autoRenew,
      },
    };

    return [
      // Configuration
      {
        provide: LOCKS_PLUGIN_OPTIONS,
        useValue: config,
      },

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
