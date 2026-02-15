import Redis, { Cluster, RedisOptions, ClusterOptions, ClusterNode } from 'ioredis';

import { BaseRedisDriver } from './base.driver';
import { IPipeline, IMulti, DriverEvent } from '../../interfaces';
import { ConnectionError, CommandError } from '../../shared/errors';
import { ConnectionConfig, isSingleConnection, isClusterConnection, isSentinelConnection } from '../../types';

/**
 * IoRedis driver adapter.
 *
 * Implements IRedisDriver using ioredis library.
 * Supports single instance, cluster, and sentinel configurations.
 *
 * @example
 * ```typescript
 * const driver = new IoRedisAdapter({
 *   host: 'localhost',
 *   port: 6379,
 * });
 * await driver.connect();
 * ```
 */
export class IoRedisAdapter extends BaseRedisDriver {
  private client: Redis | Cluster | null = null;

  constructor(
    config: ConnectionConfig,
    options?: {
      enableLogging?: boolean;
    },
  ) {
    super(config, options);
  }

  protected async doConnect(): Promise<void> {
    try {
      // Create client based on configuration type
      if (isSingleConnection(this.config)) {
        this.client = this.createSingleClient(this.config);
      } else if (isClusterConnection(this.config)) {
        this.client = this.createClusterClient(this.config);
      } else if (isSentinelConnection(this.config)) {
        this.client = this.createSentinelClient(this.config);
      } else {
        throw new ConnectionError('Unknown connection type');
      }

      // Setup event handlers
      this.setupEventHandlers();

      // Connect and wait for ready
      await new Promise<void>((resolve, reject) => {
        const onReady = (): void => {
          cleanup();
          resolve();
        };
        const onError = (error: Error): void => {
          cleanup();
          reject(new ConnectionError('Connection failed', error));
        };
        const cleanup = (): void => {
          this.client?.off('ready', onReady);
          this.client?.off('error', onError);
        };

        this.client?.once('ready', onReady);
        this.client?.once('error', onError);

        // Initiate connection (required when lazyConnect is true)
        if (this.client) {
          if (this.client instanceof Redis) {
            this.client.connect().catch(reject);
          } else if (this.client instanceof Cluster) {
            this.client.connect().catch(reject);
          }
        }
      });
    } catch (error) {
      if (this.client) {
        this.client.disconnect();
        this.client = null;
      }
      throw error instanceof ConnectionError ? error : new ConnectionError('Failed to connect', error as Error);
    }
  }

  protected async doDisconnect(): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      await this.client.quit();
    } catch {
      // Force disconnect on error
      this.client.disconnect();
    } finally {
      this.client = null;
    }
  }

  protected async executeCommand(command: string, ...args: unknown[]): Promise<unknown> {
    if (!this.client) {
      throw new ConnectionError('Client not initialized');
    }

    try {
      // IoRedis uses lowercase command names
      const method = command.toLowerCase();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fn = (this.client as any)[method];

      if (typeof fn !== 'function') {
        throw new CommandError(command, args);
      }

      return await fn.apply(this.client, args);
    } catch (error) {
      throw new CommandError(command, args, error as Error);
    }
  }

  protected createPipeline(): IPipeline {
    if (!this.client) {
      throw new ConnectionError('Client not initialized');
    }

    const ioPipeline = this.client.pipeline();

    return new IoRedisPipelineAdapter(ioPipeline);
  }

  protected createMulti(): IMulti {
    if (!this.client) {
      throw new ConnectionError('Client not initialized');
    }

    const ioMulti = this.client.multi();

    return new IoRedisMultiAdapter(ioMulti);
  }

  private createSingleClient(config: ConnectionConfig): Redis {
    // Use type guard to ensure we have ISingleConnectionConfig
    if (!isSingleConnection(config)) {
      throw new ConnectionError('Invalid single connection configuration');
    }

    const options: RedisOptions = {
      host: config.host ?? 'localhost',
      port: config.port ?? 6379,
      password: config.password,
      db: config.db ?? 0,
      keyPrefix: config.keyPrefix,
      connectTimeout: config.connectTimeout ?? 10000,
      commandTimeout: config.commandTimeout ?? 5000,
      keepAlive: config.keepAlive ?? 0,
      enableReadyCheck: config.enableAutoReconnect ?? true,
      maxRetriesPerRequest: config.maxRetriesPerRequest ?? 3,
      retryStrategy: config.retryStrategy,
      reconnectOnError: config.reconnectOnError,
      lazyConnect: true,
    };

    // TLS configuration
    if (config.tls?.enabled) {
      options.tls = {
        ca: config.tls.ca,
        cert: config.tls.cert,
        key: config.tls.key,
        rejectUnauthorized: config.tls.rejectUnauthorized ?? true,
      };
    }

    return new Redis(options);
  }

  private createClusterClient(config: ConnectionConfig): Cluster {
    if (!isClusterConnection(config)) {
      throw new ConnectionError('Invalid cluster configuration');
    }

    const nodes: ClusterNode[] = config.nodes.map((node) => ({
      host: node.host,
      port: node.port,
    }));

    const options: ClusterOptions = {
      redisOptions: {
        password: config.password,
        db: config.db ?? 0,
        keyPrefix: config.keyPrefix,
        connectTimeout: config.connectTimeout ?? 10000,
        commandTimeout: config.commandTimeout ?? 5000,
        maxRetriesPerRequest: config.maxRetriesPerRequest ?? 3,
      },
      clusterRetryStrategy: config.retryStrategy,
      enableReadyCheck: config.clusterOptions?.enableReadyCheck ?? false,
      maxRedirections: config.clusterOptions?.maxRedirections ?? 16,
      retryDelayOnClusterDown: config.clusterOptions?.retryDelayOnClusterDown ?? 100,
      retryDelayOnFailover: config.clusterOptions?.retryDelayOnFailover ?? 100,
      scaleReads: config.clusterOptions?.scaleReads ?? 'master',
      lazyConnect: true,
      // Pass through any additional cluster options (e.g., natMap)
      ...config.clusterOptions,
    };

    return new Cluster(nodes, options);
  }

  private createSentinelClient(config: ConnectionConfig): Redis {
    if (!isSentinelConnection(config)) {
      throw new ConnectionError('Invalid sentinel configuration');
    }

    const options: RedisOptions = {
      sentinels: config.sentinels,
      name: config.name,
      password: config.password,
      db: config.db ?? 0,
      keyPrefix: config.keyPrefix,
      connectTimeout: config.connectTimeout ?? 10000,
      commandTimeout: config.commandTimeout ?? 5000,
      maxRetriesPerRequest: config.maxRetriesPerRequest ?? 3,
      retryStrategy: config.retryStrategy,
      sentinelRetryStrategy: config.sentinelOptions?.sentinelRetryStrategy,
      sentinelPassword: config.sentinelOptions?.sentinelPassword,
      enableTLSForSentinelMode: config.sentinelOptions?.enableTLSForSentinelMode,
      lazyConnect: true,
      // NAT mapping for Docker/firewall scenarios
      // Maps internal Redis addresses to external accessible addresses
      natMap: config.sentinelOptions?.natMap,
    };

    return new Redis(options);
  }

  private setupEventHandlers(): void {
    if (!this.client) {
      return;
    }

    this.client.on('connect', () => {
      this.emit(DriverEvent.CONNECT);
    });

    this.client.on('ready', () => {
      this.emit(DriverEvent.READY);
    });

    this.client.on('error', (error: Error) => {
      this.emit(DriverEvent.ERROR, error);
    });

    this.client.on('close', () => {
      this.emit(DriverEvent.CLOSE);
    });

    this.client.on('reconnecting', () => {
      this.emit(DriverEvent.RECONNECTING);
    });

    this.client.on('end', () => {
      this.emit(DriverEvent.END);
    });
  }

  /**
   * Gets underlying ioredis client.
   * For advanced usage only.
   */
  getClient(): Redis | Cluster | null {
    return this.client;
  }
}

/**
 * IoRedis pipeline adapter.
 */
class IoRedisPipelineAdapter implements IPipeline {
  constructor(private readonly pipeline: ReturnType<Redis['pipeline']>) {}

  async exec(): Promise<Array<[Error | null, unknown]>> {
    const results = await this.pipeline.exec();
    if (!results) {
      return [];
    }
    return results.map(([error, result]) => [error, result]);
  }

  get(key: string): this {
    this.pipeline.get(key);
    return this;
  }

  set(key: string, value: string, options?: { ex?: number; px?: number }): this {
    if (options?.ex) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.pipeline.set as any)(key, value, 'EX', options.ex);
    } else if (options?.px) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.pipeline.set as any)(key, value, 'PX', options.px);
    } else {
      this.pipeline.set(key, value);
    }
    return this;
  }

  del(...keys: string[]): this {
    this.pipeline.del(...keys);
    return this;
  }

  mget(...keys: string[]): this {
    this.pipeline.mget(...keys);
    return this;
  }

  mset(data: Record<string, string>): this {
    this.pipeline.mset(data);
    return this;
  }

  expire(key: string, seconds: number): this {
    this.pipeline.expire(key, seconds);
    return this;
  }

  ttl(key: string): this {
    this.pipeline.ttl(key);
    return this;
  }

  incr(key: string): this {
    this.pipeline.incr(key);
    return this;
  }

  incrby(key: string, increment: number): this {
    this.pipeline.incrby(key, increment);
    return this;
  }

  hget(key: string, field: string): this {
    this.pipeline.hget(key, field);
    return this;
  }

  hset(key: string, field: string, value: string): this {
    this.pipeline.hset(key, field, value);
    return this;
  }

  hmset(key: string, data: Record<string, string>): this {
    this.pipeline.hmset(key, data);
    return this;
  }

  hgetall(key: string): this {
    this.pipeline.hgetall(key);
    return this;
  }

  lpush(key: string, ...values: string[]): this {
    this.pipeline.lpush(key, ...values);
    return this;
  }

  rpush(key: string, ...values: string[]): this {
    this.pipeline.rpush(key, ...values);
    return this;
  }

  sadd(key: string, ...members: string[]): this {
    this.pipeline.sadd(key, ...members);
    return this;
  }

  srem(key: string, ...members: string[]): this {
    this.pipeline.srem(key, ...members);
    return this;
  }

  zadd(key: string, ...args: Array<number | string>): this {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.pipeline.zadd as any)(key, ...args);
    return this;
  }

  zrem(key: string, ...members: string[]): this {
    this.pipeline.zrem(key, ...members);
    return this;
  }
}

/**
 * IoRedis multi/exec adapter.
 */
class IoRedisMultiAdapter extends IoRedisPipelineAdapter implements IMulti {
  constructor(private readonly multi: ReturnType<Redis['multi']>) {
    super(multi);
  }

  discard(): void {
    this.multi.discard();
  }
}
