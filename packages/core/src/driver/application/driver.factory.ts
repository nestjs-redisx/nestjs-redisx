import { IRedisDriver } from '../../interfaces';
import { RedisXError, ErrorCode } from '../../errors';
import { ConnectionConfig, DriverType } from '../../types';
import { IoRedisAdapter } from '../infrastructure/ioredis.adapter';
import { NodeRedisAdapter } from '../infrastructure/node-redis.adapter';

/**
 * Driver factory options.
 */
export interface IDriverFactoryOptions {
  /**
   * Driver type to create.
   * @default 'ioredis'
   */
  type?: DriverType;

  /**
   * Enable operation logging.
   * @default false
   */
  enableLogging?: boolean;
}

/**
 * Factory function for a custom driver implementation.
 */
export type DriverFactoryFn = (config: ConnectionConfig, options?: IDriverFactoryOptions) => IRedisDriver;

/**
 * Registry of custom driver types beyond the built-in ioredis/node-redis.
 * Lets first-party packages (e.g. @nestjs-redisx/testing) plug in another
 * IRedisDriver implementation without modifying core.
 */
const driverRegistry = new Map<string, DriverFactoryFn>();

/**
 * Registers a custom driver type so `createDriver({ type })` — and therefore
 * `RedisModule.forRoot({ clients: { type } })` — can construct it.
 *
 * @param type - Driver type identifier (e.g. 'memory'). Built-in types cannot be overridden.
 * @param factory - Function that builds the driver from a connection config.
 */
export function registerDriver(type: string, factory: DriverFactoryFn): void {
  if (type === 'ioredis' || type === 'node-redis') {
    throw new RedisXError(`Cannot override built-in driver type: ${type}`, ErrorCode.CFG_INVALID, undefined, { driverType: type });
  }
  driverRegistry.set(type, factory);
}

/**
 * Factory for creating Redis drivers.
 *
 * Creates driver instances based on configuration.
 * Drivers are interchangeable - switching between ioredis and node-redis
 * requires no code changes.
 *
 * @example
 * ```typescript
 * // Create ioredis driver
 * const driver = createDriver(
 *   { host: 'localhost', port: 6379 },
 *   { type: 'ioredis' }
 * );
 *
 * // Switch to node-redis (same interface)
 * const driver = createDriver(
 *   { host: 'localhost', port: 6379 },
 *   { type: 'node-redis' }
 * );
 * ```
 */
export function createDriver(config: ConnectionConfig, options?: IDriverFactoryOptions): IRedisDriver {
  const driverType = options?.type ?? 'ioredis';
  const enableLogging = options?.enableLogging ?? false;

  switch (driverType) {
    case 'ioredis':
      return new IoRedisAdapter(config, { enableLogging });

    case 'node-redis':
      return new NodeRedisAdapter(config, { enableLogging });

    default: {
      const factory = driverRegistry.get(driverType);
      if (factory) {
        return factory(config, { enableLogging });
      }
      const known = ['ioredis', 'node-redis', ...driverRegistry.keys()].join(', ');
      throw new RedisXError(`Unsupported driver type: ${driverType}. Supported types: ${known}`, ErrorCode.CFG_INVALID, undefined, { driverType });
    }
  }
}

/**
 * Driver factory class for dependency injection.
 *
 * @example
 * ```typescript
 * @Module({
 *   providers: [
 *     {
 *       provide: DRIVER_FACTORY,
 *       useClass: DriverFactory,
 *     },
 *   ],
 * })
 * export class MyModule {}
 * ```
 */
export class DriverFactory {
  /**
   * Creates a driver instance.
   */
  create(config: ConnectionConfig, options?: IDriverFactoryOptions): IRedisDriver {
    return createDriver(config, options);
  }

  /**
   * Gets supported driver types.
   */
  getSupportedTypes(): DriverType[] {
    return ['ioredis', 'node-redis'];
  }

  /**
   * Checks if driver type is supported.
   */
  isSupported(type: string): type is DriverType {
    return type === 'ioredis' || type === 'node-redis';
  }

  /**
   * Gets default driver type.
   */
  getDefaultType(): DriverType {
    return 'ioredis';
  }
}

/**
 * Creates multiple drivers from configurations.
 *
 * @example
 * ```typescript
 * const drivers = createDrivers({
 *   default: { host: 'localhost', port: 6379 },
 *   cache: { host: 'cache.local', port: 6379 },
 * });
 * ```
 */
export function createDrivers(configs: Record<string, ConnectionConfig>, options?: IDriverFactoryOptions): Record<string, IRedisDriver> {
  const drivers: Record<string, IRedisDriver> = {};

  for (const [name, config] of Object.entries(configs)) {
    drivers[name] = createDriver(config, options);
  }

  return drivers;
}

/**
 * Driver type detection helper.
 * Attempts to detect available driver library.
 */
export function detectAvailableDriver(): DriverType | null {
  try {
    require.resolve('ioredis');
    return 'ioredis';
  } catch {
    try {
      require.resolve('redis');
      return 'node-redis';
    } catch {
      return null;
    }
  }
}

/**
 * Gets recommended driver type based on environment.
 */
export function getRecommendedDriver(): DriverType {
  // ioredis is the recommended default due to:
  // - More battle-tested in production
  // - Better cluster support
  // - More features (Lua script caching, etc.)
  return 'ioredis';
}
