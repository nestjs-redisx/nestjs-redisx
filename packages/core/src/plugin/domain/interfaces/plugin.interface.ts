import { DynamicModule, ForwardReference, Provider, Type } from '@nestjs/common';

import { IPluginContext } from './plugin-context.interface';

/**
 * Async configuration options for plugins.
 * Allows plugins to receive configuration from NestJS DI (e.g., ConfigService).
 *
 * @example
 * ```typescript
 * CachePlugin.registerAsync({
 *   imports: [ConfigModule],
 *   inject: [ConfigService],
 *   useFactory: (config: ConfigService) => ({
 *     l1: { maxSize: config.get('CACHE_L1_MAX_SIZE') },
 *     swr: { enabled: config.get('CACHE_SWR_ENABLED') },
 *   }),
 * })
 * ```
 */
export interface IPluginAsyncOptions<T = unknown> {
  /**
   * Optional modules to import (e.g., ConfigModule).
   * Only needed if the injected services are not globally available.
   */
  imports?: Array<Type<unknown> | DynamicModule | ForwardReference>;

  /**
   * Dependencies to inject into the factory function.
   */
  inject?: unknown[];

  /**
   * Factory function that returns plugin options.
   * Receives injected dependencies as arguments.
   */
  useFactory: (...args: unknown[]) => T | Promise<T>;
}

/**
 * Base interface for all RedisX plugins.
 *
 * Plugins extend core functionality without modifying core code.
 * They follow the Open/Closed Principle.
 *
 * ## Lifecycle hooks
 *
 * `onRegister()`, `onModuleInit()`, `onModuleDestroy()` and `dependencies`
 * are managed by `PluginRegistryService`. Plugins are initialized in
 * topological order based on `dependencies`. During shutdown, hooks are
 * called in reverse dependency order.
 *
 * @example
 * ```typescript
 * export class CachePlugin implements IRedisXPlugin {
 *   readonly name = 'cache';
 *   readonly version = '1.0.0';
 *
 *   getProviders() {
 *     return [CacheService, TagIndexService];
 *   }
 * }
 * ```
 */
export interface IRedisXPlugin {
  /**
   * Unique plugin identifier.
   * Used for dependency resolution and configuration mapping.
   * Must be lowercase, alphanumeric with hyphens.
   *
   * @example 'cache', 'locks', 'rate-limit'
   */
  readonly name: string;

  /**
   * Plugin version following semver.
   * Used for compatibility checks.
   *
   * @example '1.0.0', '2.1.3'
   */
  readonly version: string;

  /**
   * Optional human-readable description.
   */
  readonly description?: string;

  /**
   * Names of plugins this plugin depends on.
   * Core ensures dependencies are initialized first.
   *
   * @example ['cache'] - depends on cache plugin
   */
  readonly dependencies?: string[];

  /**
   * Called immediately when plugin is registered.
   * Use for synchronous setup that doesn't require other plugins.
   *
   * @param context - Plugin context with core services
   */
  onRegister?(context: IPluginContext): void | Promise<void>;

  /**
   * Called after all plugins registered and Redis connected.
   * Dependencies are guaranteed to be initialized.
   * Use for async setup like loading Lua scripts.
   *
   * @param context - Plugin context with core services
   */
  onModuleInit?(context: IPluginContext): void | Promise<void>;

  /**
   * Called when application is shutting down.
   * Use for cleanup (close connections, flush buffers).
   * Called in reverse dependency order.
   *
   * @param context - Plugin context with core services
   */
  onModuleDestroy?(context: IPluginContext): void | Promise<void>;

  /**
   * Returns NestJS providers this plugin contributes.
   * These are registered in the DI container.
   */
  getProviders?(): Provider[];

  /**
   * Returns exports that other modules can inject.
   * Typically the main service of the plugin.
   */
  getExports?(): Array<Provider | string | symbol | Type>;

  /**
   * Returns NestJS modules to import.
   * Used by registerAsync() to make injected services available.
   */
  getImports?(): Array<Type<unknown> | DynamicModule | ForwardReference>;

  /**
   * Returns NestJS controllers this plugin contributes.
   * Controllers handle HTTP endpoints.
   */
  getControllers?(): Type[];
}
