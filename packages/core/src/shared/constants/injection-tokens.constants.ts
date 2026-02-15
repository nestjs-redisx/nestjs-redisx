/**
 * Dependency injection tokens for NestJS RedisX.
 */

/**
 * Token for injecting module options.
 * Used for synchronous and asynchronous configuration.
 */
export const REDIS_MODULE_OPTIONS = Symbol.for('REDIS_MODULE_OPTIONS');

/**
 * Token for injecting default Redis client.
 * Points to the 'default' named client.
 */
export const REDIS_CLIENT = Symbol.for('REDIS_CLIENT');

/**
 * Token for injecting Redis clients map.
 * Contains all registered named clients.
 */
export const REDIS_CLIENTS_MAP = Symbol.for('REDIS_CLIENTS_MAP');

/**
 * Token for injecting client manager.
 * Manages lifecycle of all Redis clients.
 */
export const CLIENT_MANAGER = Symbol.for('CLIENT_MANAGER');

/**
 * Token for injecting Redis driver.
 * Abstracts ioredis/node-redis implementation.
 */
export const REDIS_DRIVER = Symbol.for('REDIS_DRIVER');

/**
 * Token for injecting RedisX configuration.
 * Contains module-level and global configuration.
 */
export const REDISX_CONFIG = Symbol.for('REDISX_CONFIG');

/**
 * Token for injecting plugin registry.
 * Manages plugin lifecycle and dependencies.
 */
export const PLUGIN_REGISTRY = Symbol.for('PLUGIN_REGISTRY');

/**
 * Token for injecting registered plugins array.
 * Used internally by PluginRegistryService.
 */
export const REGISTERED_PLUGINS = Symbol.for('REGISTERED_PLUGINS');

/**
 * Token for injecting logger.
 * Provides structured logging for RedisX.
 */
export const REDISX_LOGGER = Symbol.for('REDISX_LOGGER');

/**
 * Creates a token for named Redis client.
 * @param name - Client name
 * @returns Injection token
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class MyService {
 *   constructor(
 *     @Inject(getClientToken('cache'))
 *     private readonly cacheClient: IRedisClient
 *   ) {}
 * }
 * ```
 */
export function getClientToken(name: string): symbol {
  return Symbol.for(`REDIS_CLIENT:${name}`);
}

/**
 * Creates a token for named driver.
 * @param name - Driver name
 * @returns Injection token
 */
export function getDriverToken(name: string): symbol {
  return Symbol.for(`REDIS_DRIVER:${name}`);
}

/**
 * Default client name.
 */
export const DEFAULT_CLIENT_NAME = 'default';

/**
 * Default driver type.
 */
export const DEFAULT_DRIVER_TYPE = 'ioredis';

/**
 * Module name for logging.
 */
export const MODULE_NAME = 'RedisXModule';

/**
 * Default connection timeout (ms).
 */
export const DEFAULT_CONNECTION_TIMEOUT = 10000;

/**
 * Default command timeout (ms).
 */
export const DEFAULT_COMMAND_TIMEOUT = 5000;

/**
 * Default graceful shutdown timeout (ms).
 */
export const DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT = 5000;

/**
 * Token for async clients initialization.
 * Used internally to ensure clients are created before injection.
 */
export const REDIS_CLIENTS_INITIALIZATION = Symbol.for('REDIS_CLIENTS_INITIALIZATION');

/**
 * Default health check interval (ms).
 */
export const DEFAULT_HEALTH_CHECK_INTERVAL = 30000;
