import { IRedisDriver } from '../../../interfaces';
import { ConnectionConfig, IClientMetadata } from '../../../types';
import { IHealthStatus, IConnectionStats, IReconnectionOptions } from '../types/health.types';

/**
 * Redis driver manager interface.
 *
 * Manages multiple Redis driver connections with:
 * - Lazy connection (connect on first use)
 * - Automatic reconnection with exponential backoff
 * - Health monitoring
 * - Graceful shutdown
 * - Connection pooling
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class CacheService {
 *   constructor(
 *     @Inject(CLIENT_MANAGER) private readonly clientManager: IRedisDriverManager
 *   ) {}
 *
 *   async get(key: string): Promise<string | null> {
 *     const driver = await this.clientManager.getClient('cache');
 *     return driver.get(key);
 *   }
 * }
 * ```
 */
export interface IRedisDriverManager {
  /**
   * Gets Redis driver by name.
   *
   * Performs lazy connection on first access.
   * Subsequent calls return the same connected driver.
   *
   * @param name - Client name (default: 'default')
   * @returns Redis driver instance
   * @throws Error if client not found or connection fails
   *
   * @example
   * ```typescript
   * const driver = await manager.getClient('cache');
   * await driver.set('key', 'value');
   * ```
   */
  getClient(name?: string): Promise<IRedisDriver>;

  /**
   * Creates and registers a new Redis driver.
   *
   * @param name - Unique client name
   * @param config - Redis connection configuration
   * @param options - Optional client options
   * @returns Created driver instance
   * @throws Error if client with this name already exists
   *
   * @example
   * ```typescript
   * const driver = await manager.createClient('sessions', {
   *   type: 'single',
   *   host: 'localhost',
   *   port: 6379,
   *   db: 1,
   * });
   * ```
   */
  createClient(
    name: string,
    config: ConnectionConfig,
    options?: {
      reconnection?: IReconnectionOptions;
      metadata?: Partial<IClientMetadata>;
    },
  ): Promise<IRedisDriver>;

  /**
   * Checks if client exists.
   *
   * @param name - Client name
   * @returns true if client is registered
   */
  hasClient(name: string): boolean;

  /**
   * Gets all registered client names.
   *
   * @returns Array of client names
   */
  getClientNames(): string[];

  /**
   * Closes specific client connection.
   *
   * Gracefully disconnects and removes client from registry.
   *
   * @param name - Client name
   * @throws Error if client not found
   *
   * @example
   * ```typescript
   * await manager.closeClient('cache');
   * ```
   */
  closeClient(name: string): Promise<void>;

  /**
   * Closes all client connections.
   *
   * Performs graceful shutdown of all clients in parallel.
   * Safe to call multiple times.
   *
   * @example
   * ```typescript
   * await manager.closeAll();
   * ```
   */
  closeAll(): Promise<void>;

  /**
   * Performs health check on client(s).
   *
   * Executes PING command and measures latency.
   *
   * @param name - Client name (if omitted, checks all clients)
   * @returns Health status for specified client(s)
   *
   * @example
   * ```typescript
   * // Check single client
   * const health = await manager.healthCheck('cache');
   * if (!health.healthy) {
   *   logger.error('Cache unhealthy', health);
   * }
   *
   * // Check all clients
   * const allHealth = await manager.healthCheck();
   * ```
   */
  healthCheck(name?: string): Promise<IHealthStatus | IHealthStatus[]>;

  /**
   * Gets connection statistics.
   *
   * Returns aggregate stats for all clients.
   *
   * @returns Connection statistics
   *
   * @example
   * ```typescript
   * const stats = manager.getStats();
   * console.log(`Connected: ${stats.connectedClients}/${stats.totalClients}`);
   * ```
   */
  getStats(): IConnectionStats;

  /**
   * Gets client metadata.
   *
   * @param name - Client name
   * @returns Client metadata
   * @throws Error if client not found
   */
  getMetadata(name: string): IClientMetadata;

  /**
   * Updates client metadata.
   *
   * @param name - Client name
   * @param metadata - Partial metadata to merge
   */
  updateMetadata(name: string, metadata: Partial<IClientMetadata>): void;

  /**
   * Registers event listener for all clients.
   *
   * @param event - Event name
   * @param handler - Event handler
   *
   * @example
   * ```typescript
   * manager.on('manager:reconnecting', (data) => {
   *   logger.warn(`Client ${data.name} reconnecting...`);
   * });
   * ```
   */
  on(event: ManagerEvent, handler: ManagerEventHandler): void;

  /**
   * Unregisters event listener.
   *
   * @param event - Event name
   * @param handler - Event handler
   */
  off(event: ManagerEvent, handler: ManagerEventHandler): void;
}

/**
 * Manager-specific events.
 */
export enum ManagerEvent {
  /**
   * Client connected.
   */
  CONNECTED = 'manager:connected',

  /**
   * Client disconnected.
   */
  DISCONNECTED = 'manager:disconnected',

  /**
   * Client reconnecting.
   */
  RECONNECTING = 'manager:reconnecting',

  /**
   * Client error.
   */
  ERROR = 'manager:error',

  /**
   * Client created.
   */
  CREATED = 'manager:created',

  /**
   * Client removed.
   */
  REMOVED = 'manager:removed',
}

/**
 * Manager event data.
 */
export interface IManagerEventData {
  /**
   * Client name.
   */
  name: string;

  /**
   * Event timestamp.
   */
  timestamp: Date;

  /**
   * Error if any.
   */
  error?: Error;

  /**
   * Additional context.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Manager event handler.
 */
export type ManagerEventHandler = (data: IManagerEventData) => void;
