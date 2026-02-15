import { ModuleRef } from '@nestjs/core';

import { IRedisXPlugin } from './plugin.interface';

/**
 * Context provided to plugins during lifecycle methods.
 * Gives access to core services and configuration.
 */
export interface IPluginContext {
  /**
   * Client manager for accessing and querying Redis clients.
   *
   * @example
   * ```typescript
   * if (context.clientManager.hasClient('cache')) {
   *   const client = await context.clientManager.getClient('cache');
   * }
   * ```
   */
  readonly clientManager: IClientManager;

  /**
   * Full module configuration.
   * Includes global config and plugin-specific config.
   *
   * @example
   * ```typescript
   * const cacheConfig = context.config.cache;
   * ```
   */
  readonly config: IRedisXConfig;

  /**
   * Logger instance scoped to the plugin.
   * Automatically includes plugin name in logs.
   *
   * @example
   * ```typescript
   * context.logger.info('Cache initialized', { size: 1000 });
   * ```
   */
  readonly logger: IRedisXLogger;

  /**
   * NestJS ModuleRef for advanced DI operations.
   * Use sparingly, prefer explicit injection.
   */
  readonly moduleRef: ModuleRef;

  /**
   * Gets another plugin by name.
   * Returns undefined if plugin not loaded.
   *
   * @example
   * ```typescript
   * const cachePlugin = context.getPlugin<CachePlugin>('cache');
   * ```
   */
  getPlugin<T extends IRedisXPlugin>(name: string): T | undefined;

  /**
   * Checks if a plugin is loaded.
   */
  hasPlugin(name: string): boolean;
}

/**
 * Client manager interface for plugin context.
 * Delegates to the real RedisClientManager.
 */
export interface IClientManager {
  /**
   * Gets Redis client by name.
   * @param name Client name (defaults to 'default')
   */
  getClient(name?: string): Promise<IRedisDriver>;

  /**
   * Checks if client exists.
   */
  hasClient(name: string): boolean;

  /**
   * Gets all registered client names.
   */
  getClientNames(): string[];
}

/**
 * RedisX configuration interface.
 */
export interface IRedisXConfig {
  /**
   * Redis client configurations.
   */
  clients: Record<string, IClientConfig>;

  /**
   * Registered plugins.
   */
  plugins?: IRedisXPlugin[];

  /**
   * Global configuration.
   */
  global?: {
    /** Enable debug logging */
    debug?: boolean;
    /** Default TTL for operations */
    defaultTtl?: number;
    /** Key prefix for all keys */
    keyPrefix?: string;
  };
}

/**
 * Client configuration.
 */
export interface IClientConfig {
  host?: string;
  port?: number;
  password?: string;
  db?: number;
  keyPrefix?: string;
  connectTimeout?: number;
  commandTimeout?: number;
}

/**
 * Logger interface.
 */
export interface IRedisXLogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, error?: Error, context?: Record<string, unknown>): void;
}

/**
 * Redis driver interface (re-export for context).
 */
export interface IRedisDriver {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: unknown): Promise<'OK' | null>;
  del(keys: string | string[]): Promise<number>;
  eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown>;
  evalsha(sha: string, keys: string[], args: (string | number)[]): Promise<unknown>;
  pipeline(): unknown;
}
