import { IRedisDriver } from './redis-driver.interface';
import { ConnectionConfig, IClientMetadata } from '../types';

/**
 * Redis client interface.
 *
 * Wraps IRedisDriver with additional client-level functionality.
 * Manages connection lifecycle, health checks, and metadata.
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class MyService {
 *   constructor(
 *     @Inject(REDIS_CLIENT) private readonly client: IRedisClient
 *   ) {}
 *
 *   async getData() {
 *     if (this.client.isHealthy()) {
 *       return await this.client.get('key');
 *     }
 *   }
 * }
 * ```
 */
export interface IRedisClient extends IRedisDriver {
  /**
   * Gets client name.
   */
  readonly name: string;

  /**
   * Gets connection configuration.
   */
  readonly config: ConnectionConfig;

  /**
   * Gets client metadata.
   */
  getMetadata(): IClientMetadata;

  /**
   * Checks if client is healthy (connected and responsive).
   */
  isHealthy(): boolean;

  /**
   * Gets connection uptime in milliseconds.
   * @returns Uptime or null if not connected
   */
  getUptime(): number | null;

  /**
   * Measures latency by pinging server.
   * @returns Latency in milliseconds or null if disconnected
   */
  getLatency(): Promise<number | null>;

  /**
   * Gets last error if any.
   */
  getLastError(): Error | null;

  /**
   * Clears last error.
   */
  clearLastError(): void;

  /**
   * Reconnects to Redis.
   * Disconnects if connected, then connects again.
   */
  reconnect(): Promise<void>;

  /**
   * Quits gracefully.
   * Waits for pending commands to complete before disconnecting.
   */
  quit(): Promise<void>;

  /**
   * Creates a namespaced client.
   * All keys will be prefixed with namespace.
   *
   * @example
   * ```typescript
   * const userClient = client.namespace('user');
   * await userClient.set('123', data); // Actually sets 'user:123'
   * ```
   */
  namespace(prefix: string): IRedisClient;

  /**
   * Gets current namespace prefix.
   */
  getNamespace(): string | null;
}

/**
 * Client manager interface.
 * Manages multiple named Redis clients.
 */
export interface IClientManager {
  /**
   * Gets client by name.
   * @throws Error if client not found
   */
  getClient(name?: string): IRedisClient;

  /**
   * Checks if client exists.
   */
  hasClient(name: string): boolean;

  /**
   * Gets all client names.
   */
  getClientNames(): string[];

  /**
   * Registers a new client.
   * @throws Error if client with same name already exists
   */
  registerClient(name: string, client: IRedisClient): Promise<void>;

  /**
   * Removes and disconnects client.
   */
  removeClient(name: string): Promise<void>;

  /**
   * Gets all clients.
   */
  getAllClients(): Map<string, IRedisClient>;

  /**
   * Checks health of all clients.
   */
  checkHealth(): Promise<Map<string, boolean>>;

  /**
   * Disconnects all clients.
   */
  disconnectAll(): Promise<void>;
}
