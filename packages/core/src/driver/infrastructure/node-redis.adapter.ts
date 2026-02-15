import { createClient, createCluster, createSentinel, RedisClientOptions, RedisClientType, RedisClusterType, RedisSentinelType } from 'redis';

import { BaseRedisDriver } from './base.driver';
import { IPipeline, IMulti, DriverEvent } from '../../interfaces';
import { ConnectionError, CommandError } from '../../shared/errors';
import { ConnectionConfig, isSingleConnection, isClusterConnection, isSentinelConnection } from '../../types';

/** Base delay for exponential backoff in reconnection strategy. */
const RETRY_BASE_DELAY_MS = 100;

/** Maximum delay cap for reconnection backoff. */
const RETRY_MAX_DELAY_MS = 30_000;

/**
 * Union type for all supported node-redis client types.
 */
type NodeRedisClient = RedisClientType | RedisClusterType | RedisSentinelType;

/**
 * Node-Redis driver adapter.
 *
 * Implements IRedisDriver using redis (node-redis v4+) library.
 * Supports single instance, cluster, and sentinel configurations.
 *
 * @example
 * ```typescript
 * // Single instance
 * const driver = new NodeRedisAdapter({
 *   type: 'single',
 *   host: 'localhost',
 *   port: 6379,
 * });
 *
 * // Cluster
 * const clusterDriver = new NodeRedisAdapter({
 *   type: 'cluster',
 *   nodes: [{ host: 'node1', port: 7000 }],
 * });
 *
 * // Sentinel
 * const sentinelDriver = new NodeRedisAdapter({
 *   type: 'sentinel',
 *   sentinels: [{ host: 'sentinel1', port: 26379 }],
 *   name: 'mymaster',
 * });
 *
 * await driver.connect();
 * ```
 */
export class NodeRedisAdapter extends BaseRedisDriver {
  private client: NodeRedisClient | null = null;
  private isSentinel = false;
  private isCluster = false;
  private readonly keyPrefix: string;

  constructor(
    config: ConnectionConfig,
    options?: {
      enableLogging?: boolean;
    },
  ) {
    super(config, options);
    this.keyPrefix = config.keyPrefix ?? '';
  }

  protected async doConnect(): Promise<void> {
    try {
      // Create client based on configuration type
      if (isSingleConnection(this.config)) {
        this.client = this.createSingleClient(this.config);
        this.isSentinel = false;
      } else if (isClusterConnection(this.config)) {
        this.client = this.createClusterClient(this.config);
        this.isSentinel = false;
        this.isCluster = true;
      } else if (isSentinelConnection(this.config)) {
        this.client = await this.createSentinelClient(this.config);
        this.isSentinel = true;
      } else {
        throw new ConnectionError('Unknown connection type');
      }

      // Setup event handlers
      this.setupEventHandlers();

      // Connect (sentinel already connected during creation)
      if (!this.isSentinel) {
        await this.client.connect();
      }
    } catch (error) {
      if (this.client) {
        await this.safeDisconnect();
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
      if (this.isSentinel) {
        // Sentinel uses close() instead of quit()
        await (this.client as RedisSentinelType).close();
      } else {
        // Single and cluster clients have quit()
        await (this.client as RedisClientType | RedisClusterType).quit();
      }
    } catch {
      // Force disconnect on error
      await this.safeDisconnect();
    } finally {
      this.client = null;
      this.isSentinel = false;
      this.isCluster = false;
    }
  }

  protected async executeCommand(command: string, ...args: unknown[]): Promise<unknown> {
    if (!this.client) {
      throw new ConnectionError('Client not initialized');
    }

    try {
      // Convert arguments properly (not just toString everything)
      const commandArgs = this.convertArgs(args);

      // Apply key prefix to first argument if it's a key-based command
      const prefixedArgs = this.applyKeyPrefix(command, commandArgs);

      if (this.isSentinel) {
        // Sentinel uses .use() to get a client from the pool
        return await (this.client as RedisSentinelType).use(async (client) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return await (client as any).sendCommand([command, ...prefixedArgs]);
        });
      }

      if (this.isCluster) {
        // Cluster uses different sendCommand signature:
        // sendCommand(firstKey, isReadonly, args, options?)
        const firstKey = this.getFirstKey(command, prefixedArgs);
        const isReadonly = this.isReadonlyCommand(command);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return await (this.client as any).sendCommand(firstKey, isReadonly, [command, ...prefixedArgs]);
      }

      // Execute command directly for regular clients
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await (this.client as any).sendCommand([command, ...prefixedArgs]);
    } catch (error) {
      throw new CommandError(command, args, error as Error);
    }
  }

  protected createPipeline(): IPipeline {
    if (!this.client) {
      throw new ConnectionError('Client not initialized');
    }

    if (this.isSentinel) {
      // For sentinel, we need to use the client from the pool
      return new NodeRedisSentinelPipelineAdapter(this.client as RedisSentinelType, this.keyPrefix);
    }

    return new NodeRedisPipelineAdapter(this.client as RedisClientType | RedisClusterType, this.keyPrefix);
  }

  protected createMulti(): IMulti {
    if (!this.client) {
      throw new ConnectionError('Client not initialized');
    }

    if (this.isSentinel) {
      return new NodeRedisSentinelMultiAdapter(this.client as RedisSentinelType, this.keyPrefix);
    }

    return new NodeRedisMultiAdapter(this.client as RedisClientType | RedisClusterType, this.keyPrefix);
  }

  /**
   * Override hgetall to convert array response to object.
   * Node-redis sendCommand returns ['field1', 'value1', 'field2', 'value2']
   * but we need { field1: 'value1', field2: 'value2' }
   */
  override async hgetall(key: string): Promise<Record<string, string>> {
    this.assertConnected();
    const result = await this.executeCommand('HGETALL', key);

    // Convert array to object
    if (Array.isArray(result)) {
      const obj: Record<string, string> = {};
      for (let i = 0; i < result.length; i += 2) {
        obj[result[i]] = result[i + 1];
      }
      return obj;
    }

    return (result as Record<string, string>) ?? {};
  }

  /**
   * Override scan to normalize cursor response.
   * Node-redis sendCommand returns [cursor, [keys...]]
   */
  override async scan(cursor: number, options?: { match?: string; count?: number }): Promise<[string, string[]]> {
    this.assertConnected();
    const args: unknown[] = [cursor];

    if (options?.match) {
      args.push('MATCH', options.match);
    }
    if (options?.count) {
      args.push('COUNT', options.count);
    }

    const result = await this.executeCommand('SCAN', ...args);

    if (Array.isArray(result) && result.length === 2) {
      return [String(result[0]), result[1] as string[]];
    }

    return ['0', []];
  }

  /**
   * Override hscan to normalize cursor response.
   */
  override async hscan(key: string, cursor: number, options?: { match?: string; count?: number }): Promise<[string, string[]]> {
    this.assertConnected();
    const args: unknown[] = [key, cursor];

    if (options?.match) {
      args.push('MATCH', options.match);
    }
    if (options?.count) {
      args.push('COUNT', options.count);
    }

    const result = await this.executeCommand('HSCAN', ...args);

    if (Array.isArray(result) && result.length === 2) {
      return [String(result[0]), result[1] as string[]];
    }

    return ['0', []];
  }

  /**
   * Override sscan to normalize cursor response.
   */
  override async sscan(key: string, cursor: number, options?: { match?: string; count?: number }): Promise<[string, string[]]> {
    this.assertConnected();
    const args: unknown[] = [key, cursor];

    if (options?.match) {
      args.push('MATCH', options.match);
    }
    if (options?.count) {
      args.push('COUNT', options.count);
    }

    const result = await this.executeCommand('SSCAN', ...args);

    if (Array.isArray(result) && result.length === 2) {
      return [String(result[0]), result[1] as string[]];
    }

    return ['0', []];
  }

  /**
   * Override zscan to normalize cursor response.
   */
  override async zscan(key: string, cursor: number, options?: { match?: string; count?: number }): Promise<[string, string[]]> {
    this.assertConnected();
    const args: unknown[] = [key, cursor];

    if (options?.match) {
      args.push('MATCH', options.match);
    }
    if (options?.count) {
      args.push('COUNT', options.count);
    }

    const result = await this.executeCommand('ZSCAN', ...args);

    if (Array.isArray(result) && result.length === 2) {
      return [String(result[0]), result[1] as string[]];
    }

    return ['0', []];
  }

  /**
   * Override info to return string.
   */
  override async info(section?: string): Promise<string> {
    this.assertConnected();
    const result = await this.executeCommand('INFO', ...(section ? [section] : []));
    return String(result ?? '');
  }

  private createSingleClient(config: ConnectionConfig): RedisClientType {
    if (!isSingleConnection(config)) {
      throw new ConnectionError('Invalid single connection configuration');
    }

    const options: RedisClientOptions = {
      socket: {
        host: config.host ?? 'localhost',
        port: config.port ?? 6379,
        connectTimeout: config.connectTimeout ?? 10000,
        reconnectStrategy: config.retryStrategy ? (retries) => config.retryStrategy?.(retries) ?? false : this.getDefaultReconnectStrategy(),
      },
      password: config.password,
      database: config.db ?? 0,
      commandsQueueMaxLength: config.enableOfflineQueue === false ? 0 : undefined,
    };

    // TLS configuration
    if (config.tls?.enabled) {
      options.socket = {
        ...options.socket,
        tls: true,
        ca: config.tls.ca,
        cert: config.tls.cert,
        key: config.tls.key,
        rejectUnauthorized: config.tls.rejectUnauthorized ?? true,
      };
    }

    return createClient(options) as RedisClientType;
  }

  private createClusterClient(config: ConnectionConfig): RedisClusterType {
    if (!isClusterConnection(config)) {
      throw new ConnectionError('Invalid cluster configuration');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options: any = {
      rootNodes: config.nodes.map((node) => ({
        socket: {
          host: node.host,
          port: node.port,
        },
      })),
      defaults: {
        password: config.password,
        database: config.db ?? 0,
        socket: {
          connectTimeout: config.connectTimeout ?? 10000,
          reconnectStrategy: config.retryStrategy ? (retries: number) => config.retryStrategy?.(retries) ?? false : this.getDefaultReconnectStrategy(),
        },
      },
      maxCommandRedirections: config.clusterOptions?.maxRedirections ?? 16,
      useReplicas: config.clusterOptions?.scaleReads === 'slave',
    };

    // Add nodeAddressMap for NAT/Docker scenarios
    // Converts our natMap format to node-redis nodeAddressMap format
    if (config.clusterOptions?.natMap) {
      options.nodeAddressMap = config.clusterOptions.natMap;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return createCluster(options) as any;
  }

  /**
   * Creates a Redis Sentinel client using the proper createSentinel API.
   * Returns already connected sentinel instance.
   *
   * NOTE: node-redis does not support natMap/nodeAddressMap for Sentinel.
   * For Docker/NAT environments, use ioredis driver which supports sentinelOptions.natMap.
   */
  private async createSentinelClient(config: ConnectionConfig): Promise<RedisSentinelType> {
    if (!isSentinelConnection(config)) {
      throw new ConnectionError('Invalid sentinel configuration');
    }

    const sentinelConfig = config;

    // Build sentinel root nodes from config
    const sentinelRootNodes = sentinelConfig.sentinels.map((sentinel) => ({
      host: sentinel.host,
      port: sentinel.port,
    }));

    // Build sentinel options
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options: any = {
      name: sentinelConfig.name,
      sentinelRootNodes,
      // Pool size for master connections
      masterPoolSize: sentinelConfig.sentinelOptions?.masterPoolSize ?? 1,
      // Pool size for replica connections (0 = no replicas)
      replicaPoolSize: sentinelConfig.sentinelOptions?.replicaPoolSize ?? 0,
      // Interval to scan for topology changes (ms)
      scanInterval: sentinelConfig.sentinelOptions?.scanInterval ?? 10000,
      // Max retries on topology change
      maxCommandRediscovers: sentinelConfig.sentinelOptions?.maxCommandRediscovers ?? 16,
    };

    // Node client options (for connecting to actual Redis nodes)
    const nodeClientOptions: RedisClientOptions = {
      password: sentinelConfig.password,
      database: sentinelConfig.db ?? 0,
      socket: {
        connectTimeout: sentinelConfig.connectTimeout ?? 10000,
        reconnectStrategy: sentinelConfig.retryStrategy ? (retries) => sentinelConfig.retryStrategy?.(retries) ?? false : this.getDefaultReconnectStrategy(),
      },
    };

    // TLS for nodes
    if (sentinelConfig.tls?.enabled) {
      nodeClientOptions.socket = {
        ...nodeClientOptions.socket,
        tls: true,
        ca: sentinelConfig.tls.ca,
        cert: sentinelConfig.tls.cert,
        key: sentinelConfig.tls.key,
        rejectUnauthorized: sentinelConfig.tls.rejectUnauthorized ?? true,
      };
    }

    options.nodeClientOptions = nodeClientOptions;

    // Sentinel client options (for connecting to sentinel instances)
    const sentinelClientOptions: RedisClientOptions = {
      socket: {
        connectTimeout: sentinelConfig.connectTimeout ?? 10000,
      },
    };

    // Sentinel password (if different from node password)
    if (sentinelConfig.sentinelOptions?.sentinelPassword) {
      sentinelClientOptions.password = sentinelConfig.sentinelOptions.sentinelPassword;
    }

    // TLS for sentinel connections
    if (sentinelConfig.sentinelOptions?.enableTLSForSentinelMode && sentinelConfig.tls?.enabled) {
      sentinelClientOptions.socket = {
        ...sentinelClientOptions.socket,
        tls: true,
        ca: sentinelConfig.tls.ca,
        cert: sentinelConfig.tls.cert,
        key: sentinelConfig.tls.key,
        rejectUnauthorized: sentinelConfig.tls.rejectUnauthorized ?? true,
      };
    }

    options.sentinelClientOptions = sentinelClientOptions;

    // Create and connect sentinel
    const sentinel = createSentinel(options);

    // Setup error handler before connecting
    sentinel.on('error', (error: Error) => {
      this.emit(DriverEvent.ERROR, error);
    });

    await sentinel.connect();

    return sentinel as RedisSentinelType;
  }

  /**
   * Safely disconnect the client, ignoring errors.
   */
  private async safeDisconnect(): Promise<void> {
    try {
      if (this.isSentinel) {
        await (this.client as RedisSentinelType)?.close();
      } else if (this.client) {
        // Single and cluster clients have disconnect()
        await (this.client as RedisClientType | RedisClusterType).disconnect();
      }
    } catch {
      // Ignore disconnect errors
    }
  }

  /**
   * Default reconnection strategy: exponential backoff with max 30s delay.
   * Returns a function that calculates delay based on retry count.
   */
  private getDefaultReconnectStrategy(): (retries: number) => number | false {
    return (retries: number): number | false => {
      // Max 10 retries
      if (retries > 10) {
        return false;
      }
      // Exponential backoff: 100ms, 200ms, 400ms, 800ms, 1.6s, 3.2s, 6.4s, 12.8s, 25.6s, 30s
      return Math.min(retries * RETRY_BASE_DELAY_MS * Math.pow(2, retries - 1), RETRY_MAX_DELAY_MS);
    };
  }

  /**
   * Get the first key from command arguments for cluster slot routing.
   * Returns undefined for commands that don't require a key.
   */
  private getFirstKey(command: string, args: string[]): string | undefined {
    const cmd = command.toUpperCase();

    // Commands without keys
    const noKeyCommands = new Set(['PING', 'INFO', 'DBSIZE', 'TIME', 'LASTSAVE', 'BGSAVE', 'BGREWRITEAOF', 'SLAVEOF', 'REPLICAOF', 'DEBUG', 'CONFIG', 'CLIENT', 'CLUSTER', 'COMMAND', 'FLUSHALL', 'FLUSHDB', 'SELECT', 'SWAPDB', 'PUBLISH', 'PUBSUB', 'SCRIPT', 'SLOWLOG', 'ACL', 'MODULE', 'LATENCY', 'MEMORY', 'OBJECT', 'WAIT', 'SHUTDOWN', 'SYNC', 'PSYNC', 'REPLCONF', 'ASKING', 'READONLY', 'READWRITE', 'AUTH', 'ECHO', 'QUIT']);

    if (noKeyCommands.has(cmd) || args.length === 0) {
      return undefined;
    }

    // EVAL/EVALSHA: args = [script/sha, numkeys, key1, key2, ..., arg1, arg2, ...]
    if ((cmd === 'EVAL' || cmd === 'EVALSHA') && args.length > 2) {
      const numkeys = parseInt(args[1]!, 10);
      if (numkeys > 0) {
        return args[2];
      }
      return undefined;
    }

    // Most commands have the key as first argument
    return args[0];
  }

  /**
   * Check if a command is readonly (doesn't modify data).
   * Used for cluster to route reads to replicas if enabled.
   */
  private isReadonlyCommand(command: string): boolean {
    const readonlyCommands = new Set(['GET', 'MGET', 'STRLEN', 'GETRANGE', 'SUBSTR', 'BITCOUNT', 'BITPOS', 'GETBIT', 'EXISTS', 'TYPE', 'TTL', 'PTTL', 'EXPIRETIME', 'PEXPIRETIME', 'HGET', 'HMGET', 'HGETALL', 'HKEYS', 'HVALS', 'HLEN', 'HEXISTS', 'HSCAN', 'HSTRLEN', 'HRANDFIELD', 'LINDEX', 'LLEN', 'LRANGE', 'LPOS', 'SMEMBERS', 'SISMEMBER', 'SCARD', 'SRANDMEMBER', 'SSCAN', 'SMISMEMBER', 'ZRANGE', 'ZREVRANGE', 'ZRANGEBYSCORE', 'ZREVRANGEBYSCORE', 'ZRANK', 'ZREVRANK', 'ZCOUNT', 'ZLEXCOUNT', 'ZCARD', 'ZSCORE', 'ZMSCORE', 'ZRANDMEMBER', 'ZSCAN', 'PFCOUNT', 'GEODIST', 'GEOHASH', 'GEOPOS', 'GEORADIUS_RO', 'GEORADIUSBYMEMBER_RO', 'GEOSEARCH', 'XLEN', 'XRANGE', 'XREVRANGE', 'XREAD', 'XINFO', 'XPENDING', 'SCAN', 'KEYS', 'DBSIZE', 'DEBUG', 'DUMP', 'OBJECT', 'RANDOMKEY', 'INFO', 'PING', 'TIME', 'LASTSAVE', 'ECHO']);

    return readonlyCommands.has(command.toUpperCase());
  }

  /**
   * Convert arguments to proper types for sendCommand.
   * sendCommand expects string[] but we need to handle numbers properly.
   */
  private convertArgs(args: unknown[]): string[] {
    return args.map((arg) => {
      if (arg === null || arg === undefined) {
        return '';
      }
      if (typeof arg === 'number') {
        return String(arg);
      }
      if (typeof arg === 'boolean') {
        return arg ? '1' : '0';
      }
      if (Buffer.isBuffer(arg)) {
        return arg.toString();
      }
      if (Array.isArray(arg)) {
        // Flatten arrays (for commands like MSET)
        return arg.map((item) => String(item)).join(' ');
      }
      if (typeof arg === 'object') {
        // For objects, try to serialize
        return JSON.stringify(arg);
      }
      return String(arg);
    });
  }

  /**
   * Apply key prefix to key-based commands.
   * This emulates ioredis keyPrefix functionality.
   */
  private applyKeyPrefix(command: string, args: string[]): string[] {
    if (!this.keyPrefix || args.length === 0) {
      return args;
    }

    // Commands where first argument is a key
    const singleKeyCommands = new Set(['GET', 'SET', 'DEL', 'EXISTS', 'EXPIRE', 'EXPIREAT', 'PEXPIRE', 'PEXPIREAT', 'TTL', 'PTTL', 'PERSIST', 'TYPE', 'RENAME', 'RENAMENX', 'DUMP', 'RESTORE', 'INCR', 'INCRBY', 'INCRBYFLOAT', 'DECR', 'DECRBY', 'APPEND', 'STRLEN', 'GETRANGE', 'SETRANGE', 'GETSET', 'SETNX', 'SETEX', 'PSETEX', 'GETEX', 'GETDEL', 'HGET', 'HSET', 'HSETNX', 'HDEL', 'HEXISTS', 'HGETALL', 'HINCRBY', 'HINCRBYFLOAT', 'HKEYS', 'HVALS', 'HLEN', 'HMGET', 'HMSET', 'HSCAN', 'HSTRLEN', 'HRANDFIELD', 'LPUSH', 'RPUSH', 'LPOP', 'RPOP', 'LLEN', 'LRANGE', 'LINDEX', 'LSET', 'LREM', 'LTRIM', 'LINSERT', 'LPOS', 'LPUSHX', 'RPUSHX', 'SADD', 'SREM', 'SMEMBERS', 'SISMEMBER', 'SCARD', 'SPOP', 'SRANDMEMBER', 'SSCAN', 'SMISMEMBER', 'ZADD', 'ZREM', 'ZSCORE', 'ZRANK', 'ZREVRANK', 'ZRANGE', 'ZREVRANGE', 'ZRANGEBYSCORE', 'ZREVRANGEBYSCORE', 'ZCOUNT', 'ZLEXCOUNT', 'ZCARD', 'ZINCRBY', 'ZPOPMIN', 'ZPOPMAX', 'ZMSCORE', 'ZRANDMEMBER', 'ZSCAN', 'PFADD', 'PFCOUNT', 'GEOADD', 'GEODIST', 'GEOHASH', 'GEOPOS', 'GEOSEARCH', 'SETBIT', 'GETBIT', 'BITCOUNT', 'BITPOS', 'XADD', 'XLEN', 'XRANGE', 'XREVRANGE', 'XREAD', 'XTRIM', 'XINFO', 'XDEL', 'XGROUP', 'XREADGROUP', 'XACK', 'XPENDING', 'XCLAIM', 'XAUTOCLAIM', 'WATCH', 'UNWATCH', 'OBJECT', 'DEBUG', 'MEMORY', 'COPY', 'TOUCH', 'UNLINK', 'SCAN']);

    // Commands where multiple arguments are keys
    const multiKeyCommands = new Set(['MGET', 'DEL', 'EXISTS', 'TOUCH', 'UNLINK', 'WATCH']);

    // Commands with destination key as first arg and source keys after
    const destSourceCommands = new Set(['RENAME', 'RENAMENX', 'COPY', 'BITOP', 'SINTERSTORE', 'SUNIONSTORE', 'SDIFFSTORE', 'ZUNIONSTORE', 'ZINTERSTORE', 'PFMERGE', 'GEOSEARCHSTORE', 'LMOVE', 'BLMOVE']);

    const cmd = command.toUpperCase();

    if (multiKeyCommands.has(cmd)) {
      // All args are keys
      return args.map((arg) => this.keyPrefix + arg);
    }

    if (destSourceCommands.has(cmd)) {
      // First arg is destination, rest might be keys
      if (args.length > 0) {
        const result = [...args];
        result[0] = this.keyPrefix + result[0];
        // For most dest/source commands, second arg is also a key
        if (args.length > 1 && ['RENAME', 'RENAMENX', 'COPY', 'LMOVE', 'BLMOVE'].includes(cmd)) {
          result[1] = this.keyPrefix + result[1];
        }
        return result;
      }
    }

    if (singleKeyCommands.has(cmd)) {
      // Only first arg is a key
      if (args.length > 0) {
        const result = [...args];
        result[0] = this.keyPrefix + result[0];
        return result;
      }
    }

    // Special case: MSET (key value key value ...)
    if (cmd === 'MSET' || cmd === 'MSETNX') {
      const result: string[] = [];
      for (let i = 0; i < args.length; i += 2) {
        result.push(this.keyPrefix + args[i]);
        const value = args[i + 1];
        if (value !== undefined) {
          result.push(value);
        }
      }
      return result;
    }

    return args;
  }

  private setupEventHandlers(): void {
    if (!this.client) {
      return;
    }

    // Sentinel has different event handling (already set up in createSentinelClient)
    if (this.isSentinel) {
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

    this.client.on('end', () => {
      this.emit(DriverEvent.END);
    });

    this.client.on('reconnecting', () => {
      this.emit(DriverEvent.RECONNECTING);
    });
  }

  /**
   * Gets underlying node-redis client.
   * For advanced usage only.
   */
  getClient(): NodeRedisClient | null {
    return this.client;
  }

  /**
   * Returns true if connected to Redis Sentinel.
   */
  isSentinelMode(): boolean {
    return this.isSentinel;
  }
}

/**
 * Node-Redis pipeline adapter.
 *
 * Note: node-redis doesn't have separate pipeline,
 * so we use multi() for batching.
 */
class NodeRedisPipelineAdapter implements IPipeline {
  protected commands: Array<{ command: string; args: unknown[] }> = [];

  constructor(
    protected readonly client: RedisClientType | RedisClusterType,
    protected readonly keyPrefix: string = '',
  ) {}

  async exec(): Promise<Array<[Error | null, unknown]>> {
    const multi = (this.client as RedisClientType).multi();

    for (const { command, args } of this.commands) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (multi as any).addCommand([command, ...args.map(String)]);
    }

    try {
      const results = await multi.exec();
      return (results as unknown[]).map((result) => [null, result]);
    } catch (error) {
      return [[error as Error, null]];
    }
  }

  protected prefixKey(key: string): string {
    return this.keyPrefix ? this.keyPrefix + key : key;
  }

  get(key: string): this {
    this.commands.push({ command: 'GET', args: [this.prefixKey(key)] });
    return this;
  }

  set(key: string, value: string, options?: { ex?: number; px?: number }): this {
    const args: unknown[] = [this.prefixKey(key), value];
    if (options?.ex) {
      args.push('EX', options.ex);
    } else if (options?.px) {
      args.push('PX', options.px);
    }
    this.commands.push({ command: 'SET', args });
    return this;
  }

  del(...keys: string[]): this {
    this.commands.push({ command: 'DEL', args: keys.map((k) => this.prefixKey(k)) });
    return this;
  }

  mget(...keys: string[]): this {
    this.commands.push({ command: 'MGET', args: keys.map((k) => this.prefixKey(k)) });
    return this;
  }

  mset(data: Record<string, string>): this {
    const args: unknown[] = [];
    for (const [key, value] of Object.entries(data)) {
      args.push(this.prefixKey(key), value);
    }
    this.commands.push({ command: 'MSET', args });
    return this;
  }

  expire(key: string, seconds: number): this {
    this.commands.push({ command: 'EXPIRE', args: [this.prefixKey(key), seconds] });
    return this;
  }

  ttl(key: string): this {
    this.commands.push({ command: 'TTL', args: [this.prefixKey(key)] });
    return this;
  }

  incr(key: string): this {
    this.commands.push({ command: 'INCR', args: [this.prefixKey(key)] });
    return this;
  }

  incrby(key: string, increment: number): this {
    this.commands.push({ command: 'INCRBY', args: [this.prefixKey(key), increment] });
    return this;
  }

  hget(key: string, field: string): this {
    this.commands.push({ command: 'HGET', args: [this.prefixKey(key), field] });
    return this;
  }

  hset(key: string, field: string, value: string): this {
    this.commands.push({ command: 'HSET', args: [this.prefixKey(key), field, value] });
    return this;
  }

  hmset(key: string, data: Record<string, string>): this {
    const args: unknown[] = [this.prefixKey(key)];
    for (const [field, value] of Object.entries(data)) {
      args.push(field, value);
    }
    this.commands.push({ command: 'HMSET', args });
    return this;
  }

  hgetall(key: string): this {
    this.commands.push({ command: 'HGETALL', args: [this.prefixKey(key)] });
    return this;
  }

  lpush(key: string, ...values: string[]): this {
    this.commands.push({ command: 'LPUSH', args: [this.prefixKey(key), ...values] });
    return this;
  }

  rpush(key: string, ...values: string[]): this {
    this.commands.push({ command: 'RPUSH', args: [this.prefixKey(key), ...values] });
    return this;
  }

  sadd(key: string, ...members: string[]): this {
    this.commands.push({ command: 'SADD', args: [this.prefixKey(key), ...members] });
    return this;
  }

  srem(key: string, ...members: string[]): this {
    this.commands.push({ command: 'SREM', args: [this.prefixKey(key), ...members] });
    return this;
  }

  zadd(key: string, ...args: Array<number | string>): this {
    this.commands.push({ command: 'ZADD', args: [this.prefixKey(key), ...args] });
    return this;
  }

  zrem(key: string, ...members: string[]): this {
    this.commands.push({ command: 'ZREM', args: [this.prefixKey(key), ...members] });
    return this;
  }
}

/**
 * Node-Redis multi/exec adapter.
 */
class NodeRedisMultiAdapter extends NodeRedisPipelineAdapter implements IMulti {
  constructor(client: RedisClientType | RedisClusterType, keyPrefix: string = '') {
    super(client, keyPrefix);
  }

  discard(): void {
    // Clear queued commands
    this.commands = [];
  }
}

/**
 * Node-Redis Sentinel pipeline adapter.
 * Uses sentinel.use() to get a client from the pool.
 */
class NodeRedisSentinelPipelineAdapter implements IPipeline {
  protected commands: Array<{ command: string; args: unknown[] }> = [];

  constructor(
    protected readonly sentinel: RedisSentinelType,
    protected readonly keyPrefix: string = '',
  ) {}

  async exec(): Promise<Array<[Error | null, unknown]>> {
    return await this.sentinel.use(async (client) => {
      const multi = client.multi();

      for (const { command, args } of this.commands) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (multi as any).addCommand([command, ...args.map(String)]);
      }

      try {
        const results = await multi.exec();
        return (results as unknown[]).map((result) => [null, result] as [Error | null, unknown]);
      } catch (error) {
        return [[error as Error, null]] as Array<[Error | null, unknown]>;
      }
    });
  }

  protected prefixKey(key: string): string {
    return this.keyPrefix ? this.keyPrefix + key : key;
  }

  get(key: string): this {
    this.commands.push({ command: 'GET', args: [this.prefixKey(key)] });
    return this;
  }

  set(key: string, value: string, options?: { ex?: number; px?: number }): this {
    const args: unknown[] = [this.prefixKey(key), value];
    if (options?.ex) {
      args.push('EX', options.ex);
    } else if (options?.px) {
      args.push('PX', options.px);
    }
    this.commands.push({ command: 'SET', args });
    return this;
  }

  del(...keys: string[]): this {
    this.commands.push({ command: 'DEL', args: keys.map((k) => this.prefixKey(k)) });
    return this;
  }

  mget(...keys: string[]): this {
    this.commands.push({ command: 'MGET', args: keys.map((k) => this.prefixKey(k)) });
    return this;
  }

  mset(data: Record<string, string>): this {
    const args: unknown[] = [];
    for (const [key, value] of Object.entries(data)) {
      args.push(this.prefixKey(key), value);
    }
    this.commands.push({ command: 'MSET', args });
    return this;
  }

  expire(key: string, seconds: number): this {
    this.commands.push({ command: 'EXPIRE', args: [this.prefixKey(key), seconds] });
    return this;
  }

  ttl(key: string): this {
    this.commands.push({ command: 'TTL', args: [this.prefixKey(key)] });
    return this;
  }

  incr(key: string): this {
    this.commands.push({ command: 'INCR', args: [this.prefixKey(key)] });
    return this;
  }

  incrby(key: string, increment: number): this {
    this.commands.push({ command: 'INCRBY', args: [this.prefixKey(key), increment] });
    return this;
  }

  hget(key: string, field: string): this {
    this.commands.push({ command: 'HGET', args: [this.prefixKey(key), field] });
    return this;
  }

  hset(key: string, field: string, value: string): this {
    this.commands.push({ command: 'HSET', args: [this.prefixKey(key), field, value] });
    return this;
  }

  hmset(key: string, data: Record<string, string>): this {
    const args: unknown[] = [this.prefixKey(key)];
    for (const [field, value] of Object.entries(data)) {
      args.push(field, value);
    }
    this.commands.push({ command: 'HMSET', args });
    return this;
  }

  hgetall(key: string): this {
    this.commands.push({ command: 'HGETALL', args: [this.prefixKey(key)] });
    return this;
  }

  lpush(key: string, ...values: string[]): this {
    this.commands.push({ command: 'LPUSH', args: [this.prefixKey(key), ...values] });
    return this;
  }

  rpush(key: string, ...values: string[]): this {
    this.commands.push({ command: 'RPUSH', args: [this.prefixKey(key), ...values] });
    return this;
  }

  sadd(key: string, ...members: string[]): this {
    this.commands.push({ command: 'SADD', args: [this.prefixKey(key), ...members] });
    return this;
  }

  srem(key: string, ...members: string[]): this {
    this.commands.push({ command: 'SREM', args: [this.prefixKey(key), ...members] });
    return this;
  }

  zadd(key: string, ...args: Array<number | string>): this {
    this.commands.push({ command: 'ZADD', args: [this.prefixKey(key), ...args] });
    return this;
  }

  zrem(key: string, ...members: string[]): this {
    this.commands.push({ command: 'ZREM', args: [this.prefixKey(key), ...members] });
    return this;
  }
}

/**
 * Node-Redis Sentinel multi/exec adapter.
 */
class NodeRedisSentinelMultiAdapter extends NodeRedisSentinelPipelineAdapter implements IMulti {
  constructor(sentinel: RedisSentinelType, keyPrefix: string = '') {
    super(sentinel, keyPrefix);
  }

  discard(): void {
    this.commands = [];
  }
}
