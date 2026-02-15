import { Module, DynamicModule, Provider, Type } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';

import { createRedisProviders, createAsyncProviders } from '../application/redis.providers';
import { RedisService } from '../application/redis.service';
import { PluginRegistryService } from '../plugin/application/plugin-registry.service';
import { CLIENT_MANAGER, REGISTERED_PLUGINS } from '../shared/constants';
import { IRedisModuleOptions, IRedisModuleAsyncOptions } from '../types';

/**
 * Redis module for NestJS.
 *
 * Global module that provides Redis client(s) with driver abstraction,
 * health monitoring, automatic reconnection, and plugin system.
 *
 * Module is always global - no need to import in feature modules.
 *
 * @example
 * **Synchronous configuration:**
 * ```typescript
 * @Module({
 *   imports: [
 *     RedisModule.forRoot({
 *       clients: {
 *         type: 'single',
 *         host: 'localhost',
 *         port: 6379,
 *       },
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 *
 * @example
 * **Asynchronous configuration with factory:**
 * ```typescript
 * @Module({
 *   imports: [
 *     RedisModule.forRootAsync({
 *       useFactory: (config: ConfigService) => ({
 *         clients: {
 *           type: 'single',
 *           host: config.get('REDIS_HOST'),
 *           port: config.get('REDIS_PORT'),
 *         },
 *       }),
 *       inject: [ConfigService],
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 *
 * @example
 * **With plugins:**
 * ```typescript
 * @Module({
 *   imports: [
 *     RedisModule.forRoot({
 *       clients: { type: 'single', host: 'localhost', port: 6379 },
 *       plugins: [new CachePlugin(), new LocksPlugin()],
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
@Module({})
export class RedisModule {
  /**
   * Configures Redis module synchronously.
   *
   * Creates a global module with Redis clients and plugins.
   * All providers are available for injection everywhere.
   *
   * @param options - Redis module options
   * @returns Dynamic module
   *
   * @example
   * ```typescript
   * RedisModule.forRoot({
   *   clients: {
   *     type: 'single',
   *     host: 'localhost',
   *     port: 6379,
   *   },
   *   plugins: [new CachePlugin(), new LocksPlugin()],
   * })
   * ```
   */
  static forRoot(options: IRedisModuleOptions): DynamicModule {
    const providers = createRedisProviders(options);
    const pluginProviders: Provider[] = [];
    const pluginExports: Array<string | symbol | Provider> = [];
    const pluginControllers: Type[] = [];

    // Register plugin providers and collect exports and controllers
    if (options.plugins && options.plugins.length > 0) {
      options.plugins.forEach((plugin) => {
        if (plugin.getProviders) {
          const providers = plugin.getProviders();
          if (Array.isArray(providers)) {
            pluginProviders.push(...providers);
          }
        }
        if (plugin.getExports) {
          const exports = plugin.getExports();
          if (Array.isArray(exports)) {
            pluginExports.push(...exports);
          }
        }
        if (plugin.getControllers) {
          const controllers = plugin.getControllers();
          if (Array.isArray(controllers)) {
            pluginControllers.push(...controllers);
          }
        }
      });
    }

    const plugins = options.plugins || [];

    return {
      module: RedisModule,
      global: true,
      imports: [DiscoveryModule], // Required for plugins that scan providers (e.g., CachePlugin)
      providers: [...providers, ...pluginProviders, { provide: REGISTERED_PLUGINS, useValue: plugins }, PluginRegistryService, RedisService],
      controllers: pluginControllers,
      exports: [CLIENT_MANAGER, RedisService, ...pluginExports],
    };
  }

  /**
   * Configures Redis module asynchronously.
   *
   * Allows configuration to be loaded asynchronously using factory function,
   * existing provider, or class-based factory. Supports plugins.
   *
   * Note: Plugins must be provided in the async options (outside useFactory),
   * not in the factory result. This is a standard NestJS pattern — plugins
   * must be available at module construction time for NestJS DI.
   *
   * @param options - Async Redis module options
   * @returns Dynamic module
   *
   * @example
   * **Using factory with plugins:**
   * ```typescript
   * RedisModule.forRootAsync({
   *   plugins: [new CachePlugin(), new LocksPlugin()],
   *   useFactory: (config: ConfigService) => ({
   *     clients: {
   *       type: 'single',
   *       host: config.get('REDIS_HOST'),
   *       port: config.get('REDIS_PORT'),
   *     },
   *   }),
   *   inject: [ConfigService],
   * })
   * ```
   *
   * @example
   * **Using class:**
   * ```typescript
   * @Injectable()
   * class RedisConfigService implements IRedisModuleOptionsFactory {
   *   createRedisModuleOptions(): IRedisModuleOptions {
   *     return {
   *       clients: { type: 'single', host: 'localhost', port: 6379 },
   *     };
   *   }
   * }
   *
   * RedisModule.forRootAsync({
   *   plugins: [new CachePlugin()],
   *   useClass: RedisConfigService,
   * })
   * ```
   */
  static forRootAsync(options: IRedisModuleAsyncOptions): DynamicModule {
    const baseProviders = createAsyncProviders(options);
    const imports = options.imports || [];

    // Extract plugin providers from options (provided outside useFactory)
    // This is the standard NestJS pattern - plugins are statically available,
    // similar to how @nestjs/typeorm handles entities or @nestjs/graphql handles resolvers
    const plugins = options.plugins || [];
    const pluginProviders: Provider[] = [];
    const pluginExports: Array<string | symbol | Provider> = [];
    const pluginControllers: Type[] = [];

    // Register plugin providers and collect exports and controllers
    if (plugins.length > 0) {
      plugins.forEach((plugin) => {
        if (plugin.getProviders) {
          const providers = plugin.getProviders();
          if (Array.isArray(providers)) {
            pluginProviders.push(...providers);
          }
        }
        if (plugin.getExports) {
          const exports = plugin.getExports();
          if (Array.isArray(exports)) {
            pluginExports.push(...exports);
          }
        }
        if (plugin.getControllers) {
          const controllers = plugin.getControllers();
          if (Array.isArray(controllers)) {
            pluginControllers.push(...controllers);
          }
        }
      });
    }

    return {
      module: RedisModule,
      global: true,
      imports: [DiscoveryModule, ...imports], // DiscoveryModule required for plugins
      providers: [...baseProviders, ...pluginProviders, { provide: REGISTERED_PLUGINS, useValue: plugins }, PluginRegistryService, RedisService],
      controllers: pluginControllers,
      exports: [CLIENT_MANAGER, RedisService, ...pluginExports],
    };
  }
}
