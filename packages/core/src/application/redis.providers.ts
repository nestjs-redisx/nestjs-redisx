import { Provider } from '@nestjs/common';

import { RedisClientManager } from '../client';
import { IRedisDriver } from '../interfaces';
import { REDIS_MODULE_OPTIONS, CLIENT_MANAGER, REDIS_DRIVER, REDIS_CLIENTS_INITIALIZATION, getClientToken, DEFAULT_CLIENT_NAME } from '../shared/constants';
import { IRedisModuleOptions, IRedisModuleAsyncOptions, IRedisModuleOptionsFactory, ConnectionConfig } from '../types';

/**
 * Type guard to check if clients config is a single connection.
 */
function isISingleConnectionConfig(clients: ConnectionConfig | Record<string, ConnectionConfig>): clients is ConnectionConfig {
  return 'type' in clients || 'host' in clients || 'nodes' in clients || 'sentinels' in clients;
}

/**
 * Creates Redis providers for synchronous configuration.
 *
 * @param options - Redis module options
 * @returns Array of providers
 */
export function createRedisProviders(options: IRedisModuleOptions): Provider[] {
  return [
    // Module options provider
    {
      provide: REDIS_MODULE_OPTIONS,
      useValue: options,
    },
    // Client manager provider
    {
      provide: CLIENT_MANAGER,
      useFactory: () => {
        return new RedisClientManager();
      },
    },
    // Client providers (one per connection)
    ...createClientProviders(options),
    // REDIS_DRIVER alias to default client (for backwards compatibility and plugin usage)
    {
      provide: REDIS_DRIVER,
      useFactory: async (manager: RedisClientManager): Promise<IRedisDriver> => {
        return manager.getClient(DEFAULT_CLIENT_NAME);
      },
      inject: [CLIENT_MANAGER],
    },
  ];
}

/**
 * Creates Redis providers for asynchronous configuration.
 *
 * @param options - Async Redis module options
 * @returns Array of providers
 */
export function createAsyncProviders(options: IRedisModuleAsyncOptions): Provider[] {
  const providers: Provider[] = [
    // Client manager provider
    {
      provide: CLIENT_MANAGER,
      useFactory: () => {
        return new RedisClientManager();
      },
    },
  ];

  if (options.useExisting || options.useFactory) {
    // Options provider using factory
    providers.push(createAsyncOptionsProvider(options));
  }

  if (options.useClass) {
    // Options provider using class
    providers.push(
      {
        provide: options.useClass,
        useClass: options.useClass,
      },
      createAsyncOptionsProvider(options),
    );
  }

  // Async client providers
  providers.push(...createAsyncClientProviders(options));

  // REDIS_DRIVER alias to default client (depends on initialization)
  providers.push({
    provide: REDIS_DRIVER,
    useFactory: async (
      manager: RedisClientManager,
      _init: void, // Ensure clients are initialized first
    ): Promise<IRedisDriver> => {
      return manager.getClient(DEFAULT_CLIENT_NAME);
    },
    inject: [CLIENT_MANAGER, REDIS_CLIENTS_INITIALIZATION],
  });

  return providers;
}

/**
 * Creates plugin providers from resolved options (for async configuration).
 * Must be called after REDIS_MODULE_OPTIONS is resolved.
 *
 * @param moduleOptions - Resolved Redis module options
 * @returns Array of providers and exports
 */
export function createPluginProviders(moduleOptions: IRedisModuleOptions): {
  providers: Provider[];
  exports: Array<string | symbol | Provider>;
} {
  const providers: Provider[] = [];
  const exports: Array<string | symbol | Provider> = [];

  if (moduleOptions.plugins && moduleOptions.plugins.length > 0) {
    moduleOptions.plugins.forEach((plugin) => {
      if (plugin.getProviders) {
        const pluginProviders = plugin.getProviders();
        if (Array.isArray(pluginProviders)) {
          providers.push(...pluginProviders);
        }
      }
      if (plugin.getExports) {
        const pluginExports = plugin.getExports();
        if (Array.isArray(pluginExports)) {
          exports.push(...pluginExports);
        }
      }
    });
  }

  return { providers, exports };
}

/**
 * Creates options provider for async configuration.
 */
function createAsyncOptionsProvider(options: IRedisModuleAsyncOptions): Provider {
  if (options.useFactory) {
    return {
      provide: REDIS_MODULE_OPTIONS,
      useFactory: options.useFactory,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inject: (options.inject || []) as any[],
    };
  }

  if (options.useExisting) {
    return {
      provide: REDIS_MODULE_OPTIONS,
      useFactory: async (optionsFactory: IRedisModuleOptionsFactory) => await optionsFactory.createRedisModuleOptions(),
      inject: [options.useExisting],
    };
  }

  if (options.useClass) {
    return {
      provide: REDIS_MODULE_OPTIONS,
      useFactory: async (optionsFactory: IRedisModuleOptionsFactory) => await optionsFactory.createRedisModuleOptions(),
      inject: [options.useClass],
    };
  }

  throw new Error('Invalid async options configuration');
}

/**
 * Creates client providers from module options.
 */
function createClientProviders(options: IRedisModuleOptions): Provider[] {
  const providers: Provider[] = [];
  const driverType = options.global?.driver ?? 'ioredis';

  // Handle single connection or multiple named connections
  if (isISingleConnectionConfig(options.clients)) {
    // Single connection config
    providers.push({
      provide: getClientToken(DEFAULT_CLIENT_NAME),
      useFactory: async (manager: RedisClientManager) => {
        return manager.createClient(DEFAULT_CLIENT_NAME, options.clients as ConnectionConfig, { driverType });
      },
      inject: [CLIENT_MANAGER],
    });
  } else {
    // Multiple named connections
    const configs = options.clients;

    for (const [name, config] of Object.entries(configs)) {
      providers.push({
        provide: getClientToken(name),
        useFactory: async (manager: RedisClientManager) => {
          return manager.createClient(name, config, { driverType });
        },
        inject: [CLIENT_MANAGER],
      });
    }
  }

  return providers;
}

/**
 * Creates async client providers.
 */
function createAsyncClientProviders(_options: IRedisModuleAsyncOptions): Provider[] {
  return [
    {
      provide: REDIS_CLIENTS_INITIALIZATION,
      useFactory: async (moduleOptions: IRedisModuleOptions, manager: RedisClientManager): Promise<void> => {
        const driverType = moduleOptions.global?.driver ?? 'ioredis';

        // Initialize clients from async options
        if (isISingleConnectionConfig(moduleOptions.clients)) {
          // Single connection
          await manager.createClient(DEFAULT_CLIENT_NAME, moduleOptions.clients, { driverType });
        } else {
          // Multiple connections
          const configs = moduleOptions.clients;

          for (const [name, config] of Object.entries(configs)) {
            await manager.createClient(name, config, { driverType });
          }
        }
      },
      inject: [REDIS_MODULE_OPTIONS, CLIENT_MANAGER],
    },
    {
      provide: getClientToken(DEFAULT_CLIENT_NAME),
      useFactory: async (
        manager: RedisClientManager,
        _init: void, // Ensure initialization completes first
      ): Promise<IRedisDriver> => {
        // getClient will return the initialized client
        return manager.getClient(DEFAULT_CLIENT_NAME);
      },
      inject: [CLIENT_MANAGER, REDIS_CLIENTS_INITIALIZATION],
    },
  ];
}

/**
 * Creates feature providers for specific client.
 *
 * @param name - Client name
 * @returns Array of providers
 */
export function createFeatureProviders(name: string): Provider[] {
  return [
    {
      provide: getClientToken(name),
      useFactory: async (manager: RedisClientManager): Promise<IRedisDriver> => {
        return manager.getClient(name);
      },
      inject: [CLIENT_MANAGER],
    },
  ];
}
