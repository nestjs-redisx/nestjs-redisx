import EventEmitter from 'events';

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

import { createDriver } from '../../driver';
import { DriverType } from '../../types';
import { IRedisDriver, DriverEvent } from '../../interfaces';
import { DEFAULT_CLIENT_NAME } from '../../shared/constants';
import { RedisXError, ErrorCode } from '../../errors';
import { ConnectionConfig, IClientMetadata, ConnectionStatus } from '../../types';
import { IRedisDriverManager, ManagerEvent, IManagerEventData, ManagerEventHandler } from '../domain/interfaces/client-manager.interface';
import { IHealthStatus, IConnectionStats, IClientStats, IReconnectionOptions } from '../domain/types/health.types';

/**
 * Client wrapper with metadata and statistics.
 */
interface IManagedClient {
  /**
   * Client name.
   */
  name: string;

  /**
   * Redis driver instance.
   */
  driver: IRedisDriver;

  /**
   * Connection configuration.
   */
  config: ConnectionConfig;

  /**
   * Client metadata.
   */
  metadata: IClientMetadata;

  /**
   * Reconnection options.
   */
  reconnectionOptions: Required<IReconnectionOptions>;

  /**
   * Current connection status.
   */
  status: ConnectionStatus;

  /**
   * Statistics.
   */
  stats: IClientStats;

  /**
   * Reconnection state.
   */
  reconnection: {
    attempts: number;
    nextDelay: number;
    timer?: NodeJS.Timeout;
  };

  /**
   * Whether client has been connected at least once.
   */
  everConnected: boolean;

  /**
   * Last error if any.
   */
  lastError: Error | null;
}

/**
 * Redis Client Manager.
 *
 * Manages multiple Redis client connections with:
 * - Lazy connection (connect on first use)
 * - Automatic reconnection with exponential backoff
 * - Health monitoring and statistics
 * - Graceful shutdown
 * - Event notifications
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class AppService {
 *   constructor(
 *     @Inject(CLIENT_MANAGER) private readonly clientManager: RedisClientManager
 *   ) {}
 *
 *   async cacheValue(key: string, value: string): Promise<void> {
 *     const client = await this.clientManager.getClient('cache');
 *     await client.set(key, value, { ex: 3600 });
 *   }
 * }
 * ```
 */
@Injectable()
export class RedisClientManager implements IRedisDriverManager, OnModuleDestroy {
  private readonly logger = new Logger(RedisClientManager.name);

  /**
   * Registered clients.
   */
  private readonly clients = new Map<string, IManagedClient>();

  /**
   * Event emitter for client events.
   */
  private readonly eventEmitter = new EventEmitter();

  /**
   * Whether manager is shutting down.
   */
  private isShuttingDown = false;

  /**
   * Default reconnection options.
   */
  private readonly defaultIReconnectionOptions: Required<IReconnectionOptions> = {
    maxAttempts: Infinity,
    initialDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
    enableJitter: true,
  };

  /**
   * Default driver type.
   */
  private readonly defaultDriverType: DriverType = 'ioredis';

  /**
   * Gets Redis client by name with lazy connection.
   */
  async getClient(name: string = DEFAULT_CLIENT_NAME): Promise<IRedisDriver> {
    if (this.isShuttingDown) {
      throw new RedisXError('Client manager is shutting down', ErrorCode.CONN_FAILED, undefined, { clientName: name });
    }

    const managedClient = this.clients.get(name);

    if (!managedClient) {
      throw new RedisXError(`Client "${name}" not found. Available clients: ${Array.from(this.clients.keys()).join(', ')}`, ErrorCode.CFG_INVALID, undefined, { clientName: name });
    }

    // Lazy connection on first use
    if (!managedClient.driver.isConnected() && !managedClient.everConnected) {
      await this.connectClient(managedClient);
    }

    return managedClient.driver;
  }

  /**
   * Creates and registers a new Redis client.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async createClient(
    name: string,
    config: ConnectionConfig,
    options?: {
      reconnection?: IReconnectionOptions;
      metadata?: Partial<IClientMetadata>;
      driverType?: DriverType;
    },
  ): Promise<IRedisDriver> {
    if (this.clients.has(name)) {
      throw new RedisXError(`Client "${name}" already exists`, ErrorCode.CFG_INVALID, undefined, { clientName: name });
    }

    // Create driver
    const driver = createDriver(config, {
      type: options?.driverType ?? this.defaultDriverType,
      enableLogging: false,
    });

    // Setup reconnection options
    const reconnectionOptions: Required<IReconnectionOptions> = {
      ...this.defaultIReconnectionOptions,
      ...options?.reconnection,
    };

    // Create metadata
    const metadata: IClientMetadata = {
      name,
      config,
      status: ConnectionStatus.DISCONNECTED,
      reconnectAttempts: 0,
      ...(options?.metadata || {}),
    };

    // Create managed client
    const managedClient: IManagedClient = {
      name,
      driver,
      config,
      metadata,
      reconnectionOptions,
      status: ConnectionStatus.DISCONNECTED,
      stats: this.createInitialStats(name),
      reconnection: {
        attempts: 0,
        nextDelay: reconnectionOptions.initialDelay,
      },
      everConnected: false,
      lastError: null,
    };

    // Setup event handlers
    this.setupDriverEventHandlers(managedClient);

    // Register client
    this.clients.set(name, managedClient);

    // Emit event
    this.emitEvent(ManagerEvent.CREATED, {
      name,
      timestamp: new Date(),
    });

    return driver;
  }

  /**
   * Checks if client exists.
   */
  hasClient(name: string): boolean {
    return this.clients.has(name);
  }

  /**
   * Gets all registered client names.
   */
  getClientNames(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Closes specific client connection.
   */
  async closeClient(name: string): Promise<void> {
    const managedClient = this.clients.get(name);

    if (!managedClient) {
      throw new RedisXError(`Client "${name}" not found`, ErrorCode.CFG_INVALID, undefined, { clientName: name });
    }

    await this.disconnectClient(managedClient);

    this.clients.delete(name);

    this.emitEvent(ManagerEvent.REMOVED, {
      name,
      timestamp: new Date(),
    });
  }

  /**
   * Closes all client connections.
   */
  async closeAll(): Promise<void> {
    this.isShuttingDown = true;

    const closePromises = Array.from(this.clients.values()).map((client) =>
      this.disconnectClient(client).catch((error) => {
        // Log error but don't fail
        this.logger.error(`Error closing client ${client.name}:`, error);
      }),
    );

    await Promise.all(closePromises);

    this.clients.clear();
  }

  /**
   * Performs health check on client(s).
   */
  async healthCheck(name?: string): Promise<IHealthStatus | IHealthStatus[]> {
    if (name) {
      // Check single client
      const managedClient = this.clients.get(name);

      if (!managedClient) {
        throw new RedisXError(`Client "${name}" not found`, ErrorCode.CFG_INVALID, undefined, { clientName: name });
      }

      return this.checkClientHealth(managedClient);
    } else {
      // Check all clients
      const healthChecks = await Promise.all(Array.from(this.clients.values()).map((client) => this.checkClientHealth(client)));

      return healthChecks;
    }
  }

  /**
   * Gets connection statistics.
   */
  getStats(): IConnectionStats {
    const stats: IConnectionStats = {
      totalClients: this.clients.size,
      connectedClients: 0,
      disconnectedClients: 0,
      errorClients: 0,
      clients: {},
      collectedAt: new Date(),
    };

    for (const [name, client] of this.clients) {
      stats.clients[name] = { ...client.stats };

      if (client.status === ConnectionStatus.CONNECTED) {
        stats.connectedClients++;
      } else if (client.status === ConnectionStatus.ERROR) {
        stats.errorClients++;
      } else {
        stats.disconnectedClients++;
      }
    }

    return stats;
  }

  /**
   * Gets client metadata.
   */
  getMetadata(name: string): IClientMetadata {
    const managedClient = this.clients.get(name);

    if (!managedClient) {
      throw new RedisXError(`Client "${name}" not found`, ErrorCode.CFG_INVALID, undefined, { clientName: name });
    }

    return { ...managedClient.metadata };
  }

  /**
   * Updates client metadata.
   */
  updateMetadata(name: string, metadata: Partial<IClientMetadata>): void {
    const managedClient = this.clients.get(name);

    if (!managedClient) {
      throw new RedisXError(`Client "${name}" not found`, ErrorCode.CFG_INVALID, undefined, { clientName: name });
    }

    Object.assign(managedClient.metadata, metadata);
  }

  /**
   * Registers event listener.
   */
  on(event: ManagerEvent, handler: ManagerEventHandler): void {
    this.eventEmitter.on(event, handler);
  }

  /**
   * Unregisters event listener.
   */
  off(event: ManagerEvent, handler: ManagerEventHandler): void {
    this.eventEmitter.off(event, handler);
  }

  /**
   * NestJS lifecycle hook - cleanup on module destroy.
   */
  async onModuleDestroy(): Promise<void> {
    await this.closeAll();
  }

  /**
   * Connects client with error handling.
   */
  private async connectClient(managedClient: IManagedClient): Promise<void> {
    try {
      managedClient.status = ConnectionStatus.CONNECTING;

      await managedClient.driver.connect();

      managedClient.status = ConnectionStatus.CONNECTED;
      managedClient.everConnected = true;
      managedClient.stats.connectedAt = new Date();
      managedClient.reconnection.attempts = 0;
      managedClient.reconnection.nextDelay = managedClient.reconnectionOptions.initialDelay!;
      managedClient.lastError = null;

      this.emitEvent(ManagerEvent.CONNECTED, {
        name: managedClient.name,
        timestamp: new Date(),
      });
    } catch (error) {
      managedClient.status = ConnectionStatus.ERROR;
      managedClient.stats.errors++;
      managedClient.lastError = error as Error;

      this.emitEvent(ManagerEvent.ERROR, {
        name: managedClient.name,
        timestamp: new Date(),
        error: error as Error,
      });

      throw error;
    }
  }

  /**
   * Disconnects client gracefully.
   */
  private async disconnectClient(managedClient: IManagedClient): Promise<void> {
    // Clear reconnection timer
    if (managedClient.reconnection.timer) {
      clearTimeout(managedClient.reconnection.timer);
      managedClient.reconnection.timer = undefined;
    }

    // Disconnect driver
    if (managedClient.driver.isConnected()) {
      try {
        await managedClient.driver.disconnect();
      } catch (error) {
        // Ignore disconnect errors during shutdown
        this.logger.error(`Error disconnecting client ${managedClient.name}:`, error);
      }
    }

    managedClient.status = ConnectionStatus.DISCONNECTED;

    this.emitEvent(ManagerEvent.DISCONNECTED, {
      name: managedClient.name,
      timestamp: new Date(),
    });
  }

  /**
   * Sets up driver event handlers for reconnection.
   */
  private setupDriverEventHandlers(managedClient: IManagedClient): void {
    const { driver, name } = managedClient;

    // Handle errors
    driver.on(DriverEvent.ERROR, (error?: unknown) => {
      managedClient.stats.errors++;
      managedClient.lastError = error as Error;

      if (managedClient.status === ConnectionStatus.CONNECTED) {
        // Connection lost, trigger reconnection
        this.scheduleReconnection(managedClient);
      }
    });

    // Handle close/end events
    driver.on(DriverEvent.CLOSE, () => {
      if (managedClient.status === ConnectionStatus.CONNECTED && !this.isShuttingDown) {
        managedClient.status = ConnectionStatus.DISCONNECTED;
        this.scheduleReconnection(managedClient);
      }
    });

    driver.on(DriverEvent.END, () => {
      if (managedClient.status === ConnectionStatus.CONNECTED && !this.isShuttingDown) {
        managedClient.status = ConnectionStatus.DISCONNECTED;
        this.scheduleReconnection(managedClient);
      }
    });

    // Handle ready event
    driver.on(DriverEvent.READY, () => {
      if (managedClient.status === ConnectionStatus.RECONNECTING) {
        managedClient.status = ConnectionStatus.CONNECTED;
        managedClient.reconnection.attempts = 0;
        managedClient.reconnection.nextDelay = managedClient.reconnectionOptions.initialDelay!;

        this.emitEvent(ManagerEvent.CONNECTED, {
          name,
          timestamp: new Date(),
        });
      }
    });
  }

  /**
   * Schedules reconnection with exponential backoff.
   */
  private scheduleReconnection(managedClient: IManagedClient): void {
    const { reconnectionOptions, reconnection } = managedClient;

    // Check if we've exceeded max attempts
    if (reconnection.attempts >= reconnectionOptions.maxAttempts) {
      managedClient.status = ConnectionStatus.ERROR;
      this.emitEvent(ManagerEvent.ERROR, {
        name: managedClient.name,
        timestamp: new Date(),
        error: new Error(`Max reconnection attempts (${reconnectionOptions.maxAttempts}) exceeded`),
      });
      return;
    }

    // Clear existing timer
    if (reconnection.timer) {
      clearTimeout(reconnection.timer);
    }

    // Calculate delay with exponential backoff
    let delay = reconnection.nextDelay;

    // Add jitter if enabled
    if (reconnectionOptions.enableJitter) {
      delay = delay * (0.5 + Math.random() * 0.5);
    }

    // Cap at max delay
    delay = Math.min(delay, reconnectionOptions.maxDelay);

    managedClient.status = ConnectionStatus.RECONNECTING;
    reconnection.attempts++;

    this.emitEvent(ManagerEvent.RECONNECTING, {
      name: managedClient.name,
      timestamp: new Date(),
      metadata: {
        attempt: reconnection.attempts,
        delay,
      },
    });

    // Schedule reconnection
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    reconnection.timer = setTimeout(async () => {
      try {
        await managedClient.driver.connect();

        managedClient.status = ConnectionStatus.CONNECTED;
        managedClient.stats.reconnections++;
        reconnection.attempts = 0;
        reconnection.nextDelay = reconnectionOptions.initialDelay!;

        this.emitEvent(ManagerEvent.CONNECTED, {
          name: managedClient.name,
          timestamp: new Date(),
        });
      } catch {
        // Reconnection failed, calculate next delay
        reconnection.nextDelay = Math.min(reconnection.nextDelay * reconnectionOptions.backoffMultiplier, reconnectionOptions.maxDelay);

        // Schedule next attempt
        this.scheduleReconnection(managedClient);
      }
    }, delay);
  }

  /**
   * Performs health check on single client.
   */
  private async checkClientHealth(managedClient: IManagedClient): Promise<IHealthStatus> {
    const startTime = Date.now();
    let latency: number | null = null;
    let healthy = false;

    try {
      if (managedClient.driver.isConnected()) {
        await managedClient.driver.ping();
        latency = Date.now() - startTime;
        healthy = true;

        // Update stats
        managedClient.stats.lastActivityAt = new Date();
        this.updateLatencyStats(managedClient, latency);
      }
    } catch (error) {
      managedClient.stats.errors++;
      managedClient.lastError = error as Error;
    }

    return {
      name: managedClient.name,
      healthy,
      status: managedClient.status,
      latency,
      lastError: managedClient.lastError?.message ?? null,
      lastCheckAt: new Date(),
      metadata: {
        driverType: this.defaultDriverType as string,
        connectionType: managedClient.config.type as string,
        reconnectAttempts: managedClient.reconnection.attempts,
        uptime: this.calculateUptime(managedClient),
      },
    };
  }

  /**
   * Creates initial statistics for new client.
   */
  private createInitialStats(name: string): IClientStats {
    return {
      name,
      status: ConnectionStatus.DISCONNECTED,
      commandsExecuted: 0,
      errors: 0,
      reconnections: 0,
      averageLatency: 0,
      peakLatency: 0,
      lastActivityAt: null,
      connectedAt: null,
      uptime: 0,
    };
  }

  /**
   * Updates latency statistics.
   */
  private updateLatencyStats(managedClient: IManagedClient, latency: number): void {
    const stats = managedClient.stats;

    // Update peak
    if (latency > stats.peakLatency) {
      stats.peakLatency = latency;
    }

    // Update average (simple moving average)
    if (stats.commandsExecuted === 0) {
      stats.averageLatency = latency;
    } else {
      stats.averageLatency = (stats.averageLatency * stats.commandsExecuted + latency) / (stats.commandsExecuted + 1);
    }

    stats.commandsExecuted++;
  }

  /**
   * Calculates client uptime in milliseconds.
   */
  private calculateUptime(managedClient: IManagedClient): number {
    if (!managedClient.stats.connectedAt) {
      return 0;
    }

    if (managedClient.status !== ConnectionStatus.CONNECTED) {
      return 0;
    }

    return Date.now() - managedClient.stats.connectedAt.getTime();
  }

  /**
   * Emits manager event.
   */
  private emitEvent(event: ManagerEvent, data: IManagerEventData): void {
    this.eventEmitter.emit(event, data);
  }
}
