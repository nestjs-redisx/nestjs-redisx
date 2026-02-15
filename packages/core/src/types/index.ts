/**
 * Configuration types for NestJS RedisX.
 * Based on ARCHITECTURE.md - Configuration Schema.
 */

import { ModuleMetadata, Type } from '@nestjs/common';

import { IRedisXPlugin } from '../plugin/domain/interfaces';

/**
 * Base connection options common to all connection types.
 */
export interface IBaseConnectionConfig {
  /**
   * Password for authentication.
   */
  password?: string;

  /**
   * Database number (0-15).
   * @default 0
   */
  db?: number;

  /**
   * Key prefix for all operations.
   * @example 'myapp:'
   */
  keyPrefix?: string;

  /**
   * Connection timeout in milliseconds.
   * @default 10000
   */
  connectTimeout?: number;

  /**
   * Command timeout in milliseconds.
   * @default 5000
   */
  commandTimeout?: number;

  /**
   * Keep-alive interval in milliseconds.
   * @default 0 (disabled)
   */
  keepAlive?: number;

  /**
   * Enable offline queue.
   * @default true
   */
  enableOfflineQueue?: boolean;

  /**
   * Enable auto-reconnect.
   * @default true
   */
  enableAutoReconnect?: boolean;

  /**
   * Maximum retry attempts for commands.
   * @default 3
   */
  maxRetriesPerRequest?: number;

  /**
   * Retry strategy function.
   */
  retryStrategy?: (times: number) => number | null;

  /**
   * Reconnect on error function.
   */
  reconnectOnError?: (error: Error) => boolean | 1 | 2;
}

/**
 * Single instance Redis connection configuration.
 */
export interface ISingleConnectionConfig extends IBaseConnectionConfig {
  /**
   * Connection type discriminator.
   */
  type?: 'single';

  /**
   * Redis host.
   * @default 'localhost'
   */
  host?: string;

  /**
   * Redis port.
   * @default 6379
   */
  port?: number;

  /**
   * Optional TLS configuration.
   */
  tls?: ITlsConfig;
}

/**
 * Redis Cluster connection configuration.
 */
export interface IClusterConnectionConfig extends IBaseConnectionConfig {
  /**
   * Connection type discriminator.
   */
  type: 'cluster';

  /**
   * Cluster nodes.
   * @example [{ host: 'localhost', port: 6379 }, { host: 'localhost', port: 6380 }]
   */
  nodes: Array<{
    host: string;
    port: number;
  }>;

  /**
   * Cluster-specific options.
   */
  clusterOptions?: {
    /**
     * Maximum number of redirections.
     * @default 16
     */
    maxRedirections?: number;

    /**
     * Retry delay for cluster commands.
     * @default 100
     */
    retryDelayOnClusterDown?: number;

    /**
     * Retry delay when all slots covered.
     * @default 100
     */
    retryDelayOnFailover?: number;

    /**
     * Scale reads to slaves.
     * @default 'master'
     */
    scaleReads?: 'master' | 'slave' | 'all';

    /**
     * Enable readonly mode for slave nodes.
     * @default false
     */
    enableReadyCheck?: boolean;

    /**
     * NAT mapping for Docker/firewall scenarios.
     * Maps internal IPs to external accessible addresses.
     * @example { '172.17.0.2:6379': { host: 'localhost', port: 6379 } }
     */
    natMap?: Record<string, { host: string; port: number }>;

    /**
     * Additional ioredis cluster options.
     * Allows passing any other ioredis ClusterOptions.
     */
    [key: string]: unknown;
  };
}

/**
 * Redis Sentinel connection configuration.
 */
export interface ISentinelConnectionConfig extends IBaseConnectionConfig {
  /**
   * Connection type discriminator.
   */
  type: 'sentinel';

  /**
   * Sentinel nodes.
   */
  sentinels: Array<{
    host: string;
    port: number;
  }>;

  /**
   * Master name.
   */
  name: string;

  /**
   * Optional TLS configuration.
   */
  tls?: ITlsConfig;

  /**
   * Sentinel-specific options.
   */
  sentinelOptions?: {
    /**
     * Enable TLS for sentinel connections.
     */
    enableTLSForSentinelMode?: boolean;

    /**
     * Sentinel password (if different from node password).
     */
    sentinelPassword?: string;

    /**
     * Retry strategy for sentinel.
     */
    sentinelRetryStrategy?: (times: number) => number | null;

    /**
     * Prefer slave nodes for reads.
     * @default false
     */
    preferredSlaves?: boolean;

    /**
     * NAT mapping for sentinel-managed instances.
     * Maps internal master/slave addresses to external accessible addresses.
     * @example { 'redis-master:6379': { host: 'localhost', port: 6379 } }
     */
    natMap?: Record<string, { host: string; port: number }>;

    /**
     * Master connection pool size.
     * Number of connections to maintain to the master node.
     * @default 1
     */
    masterPoolSize?: number;

    /**
     * Replica connection pool size per node.
     * Set to 0 to disable replica connections.
     * @default 0
     */
    replicaPoolSize?: number;

    /**
     * Interval in milliseconds to scan for topology changes.
     * @default 10000
     */
    scanInterval?: number;

    /**
     * Maximum number of command rediscovers on topology change.
     * @default 16
     */
    maxCommandRediscovers?: number;

    /**
     * Additional ioredis/node-redis sentinel options.
     */
    [key: string]: unknown;
  };
}

/**
 * TLS configuration.
 */
export interface ITlsConfig {
  /**
   * Enable TLS.
   * @default false
   */
  enabled?: boolean;

  /**
   * CA certificate.
   */
  ca?: string | Buffer;

  /**
   * Client certificate.
   */
  cert?: string | Buffer;

  /**
   * Client key.
   */
  key?: string | Buffer;

  /**
   * Reject unauthorized certificates.
   * @default true
   */
  rejectUnauthorized?: boolean;
}

/**
 * Union type for all connection configurations.
 */
export type ConnectionConfig = ISingleConnectionConfig | IClusterConnectionConfig | ISentinelConnectionConfig;

/**
 * Configuration for a single Redis client.
 */
export interface IRedisClientOptions {
  /**
   * Client name (for named clients).
   * @default 'default'
   */
  name?: string;

  /**
   * Connection configuration.
   */
  connection: ConnectionConfig;

  /**
   * Namespace/prefix for this client.
   * Overrides connection.keyPrefix.
   */
  namespace?: string;
}

/**
 * Driver type for Redis connections.
 */
export type DriverType = 'ioredis' | 'node-redis';

/**
 * Global module configuration options.
 */
export interface IGlobalConfig {
  /**
   * Redis driver to use.
   * @default 'ioredis'
   */
  driver?: DriverType;

  /**
   * Enable debug logging.
   * @default false
   */
  debug?: boolean;

  /**
   * Default TTL for cache operations (seconds).
   * @default 3600
   */
  defaultTtl?: number;

  /**
   * Global key prefix for all clients.
   */
  keyPrefix?: string;

  /**
   * Enable graceful shutdown.
   * @default true
   */
  gracefulShutdown?: boolean;

  /**
   * Graceful shutdown timeout (milliseconds).
   * @default 5000
   */
  gracefulShutdownTimeout?: number;

  /**
   * Enable health checks.
   * @default true
   */
  enableHealthChecks?: boolean;

  /**
   * Health check interval (milliseconds).
   * @default 30000
   */
  healthCheckInterval?: number;
}

/**
 * Synchronous module configuration.
 */
export interface IRedisModuleOptions {
  /**
   * Redis client configurations.
   * Can be a single config or a map of named clients.
   */
  clients: ConnectionConfig | Record<string, ConnectionConfig>;

  /**
   * Registered plugins.
   */
  plugins?: IRedisXPlugin[];

  /**
   * Global configuration.
   */
  global?: IGlobalConfig;
}

/**
 * Factory function for async configuration.
 */
export interface IRedisModuleOptionsFactory {
  /**
   * Creates module options asynchronously.
   */
  createRedisModuleOptions(): Promise<IRedisModuleOptions> | IRedisModuleOptions;
}

/**
 * Asynchronous module configuration.
 */
export interface IRedisModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  /**
   * Registered plugins.
   * Plugins must be provided outside useFactory to ensure providers are available at module construction time.
   * This is a standard NestJS pattern (similar to @nestjs/typeorm entities, @nestjs/graphql resolvers).
   */
  plugins?: IRedisXPlugin[];

  /**
   * Factory function returning options.
   */
  useFactory?: (...args: unknown[]) => Promise<IRedisModuleOptions> | IRedisModuleOptions;

  /**
   * Dependencies to inject into factory.
   */
  inject?: unknown[];

  /**
   * Use existing provider.
   */
  useExisting?: Type<IRedisModuleOptionsFactory>;

  /**
   * Use class provider.
   */
  useClass?: Type<IRedisModuleOptionsFactory>;
}

/**
 * Client metadata stored in the registry.
 */
export interface IClientMetadata {
  /**
   * Client name.
   */
  name: string;

  /**
   * Connection configuration.
   */
  config: ConnectionConfig;

  /**
   * Connection status.
   */
  status: ConnectionStatus;

  /**
   * Last connection time.
   */
  connectedAt?: Date;

  /**
   * Last error.
   */
  lastError?: Error;

  /**
   * Number of reconnection attempts.
   */
  reconnectAttempts: number;
}

/**
 * Connection status.
 */
export enum ConnectionStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  ERROR = 'error',
}

/**
 * Health check result.
 */
export interface IHealthCheckResult {
  /**
   * Overall health status.
   */
  status: 'healthy' | 'unhealthy' | 'degraded';

  /**
   * Individual client statuses.
   */
  clients: Record<string, IClientHealthStatus>;

  /**
   * Timestamp of check.
   */
  timestamp: Date;
}

/**
 * Client health status.
 */
export interface IClientHealthStatus {
  /**
   * Client name.
   */
  name: string;

  /**
   * Connection status.
   */
  status: ConnectionStatus;

  /**
   * Latency in milliseconds (ping).
   */
  latency?: number;

  /**
   * Last error message.
   */
  error?: string;

  /**
   * Uptime in milliseconds.
   */
  uptime?: number;
}

/**
 * Type guard for single connection config.
 */
export function isSingleConnection(config: ConnectionConfig): config is ISingleConnectionConfig {
  return !('type' in config) || config.type === 'single';
}

/**
 * Type guard for cluster connection config.
 */
export function isClusterConnection(config: ConnectionConfig): config is IClusterConnectionConfig {
  return 'type' in config && config.type === 'cluster';
}

/**
 * Type guard for sentinel connection config.
 */
export function isSentinelConnection(config: ConnectionConfig): config is ISentinelConnectionConfig {
  return 'type' in config && config.type === 'sentinel';
}

/**
 * Type guard for async options with factory.
 */
export function hasFactory(options: IRedisModuleAsyncOptions): options is Required<Pick<IRedisModuleAsyncOptions, 'useFactory'>> & IRedisModuleAsyncOptions {
  return options.useFactory !== undefined;
}

/**
 * Type guard for async options with existing provider.
 */
export function hasExisting(options: IRedisModuleAsyncOptions): options is Required<Pick<IRedisModuleAsyncOptions, 'useExisting'>> & IRedisModuleAsyncOptions {
  return options.useExisting !== undefined;
}

/**
 * Type guard for async options with class provider.
 */
export function hasClass(options: IRedisModuleAsyncOptions): options is Required<Pick<IRedisModuleAsyncOptions, 'useClass'>> & IRedisModuleAsyncOptions {
  return options.useClass !== undefined;
}
