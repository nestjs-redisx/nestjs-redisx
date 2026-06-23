import { DynamicModule } from '@nestjs/common';
import { RedisModule, type IRedisModuleOptions, type IRedisModuleAsyncOptions } from '@nestjs-redisx/core';

import { MEMORY_DRIVER_TYPE } from '../../shared/constants';
import { registerMemoryDriver } from './register-memory-driver';

/** Default (ignored) connection config — the memory driver never connects. */
const DEFAULT_CLIENTS: IRedisModuleOptions['clients'] = { type: 'single', host: 'localhost', port: 6379 };

/** Module options where `clients` is optional — the in-memory driver never connects. */
export type RedisTestingModuleOptions = Omit<IRedisModuleOptions, 'clients'> & {
  clients?: IRedisModuleOptions['clients'];
};

/** Async options whose factory may omit `clients`. */
export type RedisTestingModuleAsyncOptions = Omit<IRedisModuleAsyncOptions, 'useFactory'> & {
  useFactory?: (...args: unknown[]) => RedisTestingModuleOptions | Promise<RedisTestingModuleOptions>;
};

/**
 * Ergonomic wrapper around `RedisModule` that forces the in-memory driver,
 * so plugins run with real semantics and no Redis. Equivalent to calling
 * `RedisModule.forRoot({ global: { driver: 'memory' }, ... })`.
 */
export class RedisTestingModule {
  static forRoot(options: RedisTestingModuleOptions = {}): DynamicModule {
    registerMemoryDriver();
    return RedisModule.forRoot({
      ...options,
      clients: options.clients ?? DEFAULT_CLIENTS,
      global: { ...options.global, driver: MEMORY_DRIVER_TYPE },
    });
  }

  static forRootAsync(options: RedisTestingModuleAsyncOptions): DynamicModule {
    registerMemoryDriver();
    const userFactory = options.useFactory;
    return RedisModule.forRootAsync({
      ...options,
      useFactory: async (...args: unknown[]): Promise<IRedisModuleOptions> => {
        const resolved = userFactory ? await userFactory(...args) : ({} as RedisTestingModuleOptions);
        return {
          ...resolved,
          clients: resolved.clients ?? DEFAULT_CLIENTS,
          global: { ...resolved.global, driver: MEMORY_DRIVER_TYPE },
        };
      },
    });
  }
}
