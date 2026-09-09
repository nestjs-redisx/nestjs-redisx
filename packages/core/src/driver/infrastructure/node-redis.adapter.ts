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
  /**
   * Command deadline honoring the documented `commandTimeout` config option.
   * Applied twice: natively per command on every topology (v5's `timeout`
   * option, which also CANCELS a command that was never sent) and as an
   * outer race that bounds the whole dispatch (including the sentinel
   * pool-lease wait). OPT-IN only (no default): a default would break long
   * blocking commands for existing deployments. A deadline on a command
   * already on the wire only abandons the local wait — it may still execute
   * server-side.
   */
  private readonly commandTimeout: number | undefined;

  /**
   * True once an initial connect has succeeded. @redis/client applies the
   * reconnect strategy to the INITIAL connection too, so an unconditional
   * retry-forever default would make `connect()` never settle with Redis
   * down at bootstrap — NestFactory.create() would hang with no error.
   * The default strategy is bounded until the first success and retries
   * forever afterwards.
   */
  private everConnectedOnce = false;

  constructor(
    config: ConnectionConfig,
    options?: {
      enableLogging?: boolean;
    },
  ) {
    super(config, options);
    this.keyPrefix = config.keyPrefix ?? '';
    this.commandTimeout = config.commandTimeout;
  }

  protected async doConnect(): Promise<void> {
    // The initial-connect bound is per connect() attempt: a reconnect after
    // a manual disconnect creates a brand-new client whose FIRST connection
    // must also settle instead of retrying forever with Redis down.
    this.everConnectedOnce = false;
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
      // From here on the retry-forever default applies: a later outage must
      // never permanently close the client (see getDefaultReconnectStrategy).
      this.everConnectedOnce = true;
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
      // Bounded: a graceful QUIT/close landing in a reconnect window can
      // PEND FOREVER in @redis/client (the queued QUIT has no timeout, and
      // the reconnect loop exits without flushing the queue once quit
      // flipped the open flag) — which would hang closeAll and the whole
      // application shutdown. On timeout, fall through to a force close.
      const graceful = this.isSentinel
        ? // Sentinel uses close() instead of quit()
          (this.client as RedisSentinelType).close()
        : // Single and cluster clients have quit()
          (this.client as RedisClientType | RedisClusterType).quit();
      await this.boundGracefulClose(graceful);
    } catch {
      // Force disconnect on error
      await this.safeDisconnect();
    } finally {
      this.client = null;
      this.isSentinel = false;
      this.isCluster = false;
    }
  }

  /**
   * Rejects when the graceful close outlives its deadline (commandTimeout,
   * else 5s). `||`, not `??`: `commandTimeout: 0` means "no per-command
   * deadline" — the CLOSE bound must never be zero (a 0 ms race turns
   * every shutdown into a force disconnect) and never absent (an unbounded
   * close is the shutdown-hang bug this exists to prevent).
   */
  private async boundGracefulClose(graceful: Promise<unknown>): Promise<void> {
    graceful.catch(() => undefined);
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        graceful,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('graceful close timed out')), this.commandTimeout || 5000);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
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

      // Native per-command deadline: @redis/client v5 cancels a timed-out
      // command that was never sent (removes it from the write queue), so it
      // cannot execute server-side arbitrarily late after the local wait was
      // abandoned. The outer race below remains as the envelope bound (and
      // covers the sentinel pool-lease wait, where options are not passed).
      const nativeOptions = this.commandTimeout ? { timeout: this.commandTimeout } : undefined;
      const dispatch = (): Promise<unknown> => {
        if (this.isSentinel) {
          // Sentinel uses .use() to get a client from the pool. The pooled
          // client's signature is sendCommand(isReadonly, args, options) —
          // NOT the single-client (args, options) shape; the wrong shape
          // put the command array into the isReadonly slot and every
          // command failed.
          const isReadonly = this.isReadonlyCommand(command);
          return (this.client as RedisSentinelType).use(async (client) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return nativeOptions ? await (client as any).sendCommand(isReadonly, [command, ...prefixedArgs], nativeOptions) : await (client as any).sendCommand(isReadonly, [command, ...prefixedArgs]);
          });
        }

        if (this.isCluster) {
          // Cluster uses different sendCommand signature:
          // sendCommand(firstKey, isReadonly, args, options?)
          const firstKey = this.getFirstKey(command, prefixedArgs);
          const isReadonly = this.isReadonlyCommand(command);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return nativeOptions ? (this.client as any).sendCommand(firstKey, isReadonly, [command, ...prefixedArgs], nativeOptions) : (this.client as any).sendCommand(firstKey, isReadonly, [command, ...prefixedArgs]);
        }

        // Execute command directly for regular clients
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return nativeOptions ? (this.client as any).sendCommand([command, ...prefixedArgs], nativeOptions) : (this.client as any).sendCommand([command, ...prefixedArgs]);
      };

      return await this.withCommandTimeout(dispatch());
    } catch (error) {
      throw new CommandError(command, args, error as Error);
    }
  }

  /**
   * Race a dispatched command against the configured `commandTimeout`.
   * The rejection is wrapped into CommandError (with the command name) by
   * the caller; the deadline only abandons the local wait — the command may
   * still execute server-side.
   */
  private async withCommandTimeout(execution: Promise<unknown>): Promise<unknown> {
    if (!this.commandTimeout) {
      return execution;
    }
    // A late settlement after the deadline won must not surface as an
    // unhandled rejection.
    execution.catch(() => undefined);
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        execution,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`timed out after ${this.commandTimeout}ms`)), this.commandTimeout);
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
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

    return new NodeRedisPipelineAdapter(this.client as RedisClientType | RedisClusterType, this.keyPrefix, this.isCluster);
  }

  protected createMulti(): IMulti {
    if (!this.client) {
      throw new ConnectionError('Client not initialized');
    }

    if (this.isSentinel) {
      return new NodeRedisSentinelMultiAdapter(this.client as RedisSentinelType, this.keyPrefix);
    }
    return new NodeRedisMultiAdapter(this.client as RedisClientType | RedisClusterType, this.keyPrefix, this.isCluster);
  }

  /**
   * Override hgetall to convert array response to object.
   * Node-redis sendCommand returns ['field1', 'value1', 'field2', 'value2']
   * but we need { field1: 'value1', field2: 'value2' }
   */
  /**
   * Pub/Sub overrides: node-redis v4 delivers messages ONLY through listeners
   * passed to subscribe()/pSubscribe() (a raw SUBSCRIBE via sendCommand would
   * put the connection in subscriber mode without any delivery path). Incoming
   * messages are re-emitted as DriverEvent.MESSAGE / PMESSAGE.
   *
   * Supported on single-node clients (use a dedicated connection); cluster and
   * sentinel pub/sub are not supported by this adapter — use ioredis for those
   * topologies.
   */
  override async subscribe(...channels: string[]): Promise<void> {
    const client = this.subscriptionClient('SUBSCRIBE');
    await client.subscribe(channels, (message: string, channel: string) => {
      this.emit(DriverEvent.MESSAGE, channel, message);
    });
  }

  override async unsubscribe(...channels: string[]): Promise<void> {
    const client = this.subscriptionClient('UNSUBSCRIBE');
    await client.unsubscribe(channels);
  }

  override async psubscribe(...patterns: string[]): Promise<void> {
    const client = this.subscriptionClient('PSUBSCRIBE');
    // Register per pattern so the emitted event can carry the pattern.
    for (const pattern of patterns) {
      await client.pSubscribe(pattern, (message: string, channel: string) => {
        this.emit(DriverEvent.PMESSAGE, pattern, channel, message);
      });
    }
  }

  override async punsubscribe(...patterns: string[]): Promise<void> {
    const client = this.subscriptionClient('PUNSUBSCRIBE');
    await client.pUnsubscribe(patterns);
  }

  private subscriptionClient(command: string): RedisClientType {
    if (!this.client) {
      throw new ConnectionError('Client not initialized');
    }
    if (this.isCluster || this.isSentinel) {
      throw new CommandError(command, [], new Error('Pub/Sub is not supported by the node-redis adapter on cluster/sentinel topologies. Use the ioredis driver for Pub/Sub on these topologies.'));
    }
    return this.client as RedisClientType;
  }

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
        reconnectStrategy: this.buildReconnectStrategy(config),
      },
      username: config.username,
      password: config.password,
      database: config.db ?? 0,
      // node-redis's real knob; `commandsQueueMaxLength: 0` looked
      // equivalent but the library treats 0 as "no limit" (falsy guard).
      disableOfflineQueue: config.enableOfflineQueue === false,
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
        username: config.username,
        password: config.password,
        database: config.db ?? 0,
        disableOfflineQueue: config.enableOfflineQueue === false,
        socket: {
          connectTimeout: config.connectTimeout ?? 10000,
          reconnectStrategy: this.buildReconnectStrategy(config),
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
      username: sentinelConfig.username,
      password: sentinelConfig.password,
      database: sentinelConfig.db ?? 0,
      disableOfflineQueue: sentinelConfig.enableOfflineQueue === false,
      socket: {
        connectTimeout: sentinelConfig.connectTimeout ?? 10000,
        reconnectStrategy: this.buildReconnectStrategy(sentinelConfig),
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

    // NOTE: `sentinelOptions.sentinelRetryStrategy` is deliberately NOT
    // mapped here — @redis/client hardcodes `reconnectStrategy: false` on
    // every sentinel-monitor client it creates (a failed sentinel rotates
    // to the next one instead of reconnecting), overriding anything set in
    // these options. The option is ioredis-only; see the type's JSDoc.

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

    try {
      await sentinel.connect();
    } catch (error) {
      // A failed connect still leaves the instance live: its finally-block
      // installs the scan interval regardless, and partially-connected
      // internal clients stay open. `this.client` is not assigned yet, so
      // doConnect's catch cannot clean this up — destroy it here or every
      // failed bootstrap attempt leaks an interval + client set.
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (sentinel as any).destroy?.();
      } catch {
        // Best effort — the original connect error is what matters.
      }
      throw error;
    }

    return sentinel as RedisSentinelType;
  }

  /**
   * Safely disconnect the client, ignoring errors.
   */
  private async safeDisconnect(): Promise<void> {
    try {
      // The force path must SETTLE too: on sentinel, both close() and
      // destroy() await the same internal connect/reconfigure promise, so a
      // wedged reconfigure (unreachable announced master) would otherwise
      // hang shutdown forever right after the graceful close timed out for
      // the same reason. Bounded and best-effort — on timeout we proceed
      // and accept a leaked handle over a wedged application shutdown.
      let force: Promise<unknown> | undefined;
      if (this.isSentinel && this.client) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        force = Promise.resolve(typeof (this.client as any).destroy === 'function' ? (this.client as any).destroy() : (this.client as RedisSentinelType).close());
      } else if (this.client) {
        // Single and cluster clients have disconnect()
        force = Promise.resolve((this.client as RedisClientType | RedisClusterType).disconnect());
      }
      if (force) {
        await this.boundGracefulClose(force);
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
      if (!this.everConnectedOnce && retries > 10) {
        // Initial connect must SETTLE: the strategy also governs the very
        // first connection, and retrying forever there would hang
        // bootstrap silently instead of surfacing a ConnectionError.
        return false;
      }
      // After the first success, never give up: @redis/client treats a
      // `false` return as PERMANENT — the client closes and no later
      // connect() revives it, so a finite bound turned any outage longer
      // than the backoff sum (~2.5 min) into a dead client until process
      // restart. Parity with ioredis, whose default also retries forever.
      // Exponential backoff: 100ms, 200ms, 400ms, ... capped at 30s.
      return Math.min(retries * RETRY_BASE_DELAY_MS * Math.pow(2, retries - 1), RETRY_MAX_DELAY_MS);
    };
  }

  /**
   * `reconnectStrategy: false` disables reconnection entirely
   * (enableAutoReconnect: false); a user strategy returning null maps to
   * `false` for @redis/client.
   */
  private buildReconnectStrategy(config: { enableAutoReconnect?: boolean; retryStrategy?: (times: number) => number | null }): false | ((retries: number) => number | false) {
    if (config.enableAutoReconnect === false) {
      return false;
    }
    if (config.retryStrategy) {
      return (retries: number) => config.retryStrategy?.(retries) ?? false;
    }
    return this.getDefaultReconnectStrategy();
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

    // EVAL/EVALSHA: args = [script/sha, numkeys, key1..keyN, arg1..argM] —
    // prefix exactly the declared key positions. ioredis prefixes script
    // keys through its native keyPrefix, so omitting them here would make
    // Lua scripts and plain commands operate on DIFFERENT keys under
    // node-redis (and diverge between the two drivers).
    if (cmd === 'EVAL' || cmd === 'EVALSHA') {
      const numkeys = Number.parseInt(args[1] ?? '0', 10);
      if (Number.isInteger(numkeys) && numkeys > 0 && args.length > 2) {
        const result = [...args];
        const end = Math.min(2 + numkeys, result.length);
        for (let i = 2; i < end; i++) {
          result[i] = this.keyPrefix + result[i];
        }
        return result;
      }
      return args;
    }

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
 * v5 throws MultiErrorReply — carrying every command's reply — when ANY
 * command in the batch errored. Map it back to the ioredis-style per-slot
 * [error|null, result] contract instead of collapsing the whole batch
 * (successful replies included) into one error tuple.
 */
function mapBatchError(error: unknown): Array<[Error | null, unknown]> {
  const batchError = error as { replies?: unknown[]; errorIndexes?: number[] };
  if (Array.isArray(batchError.replies)) {
    const errorIndexes = new Set(batchError.errorIndexes ?? []);
    return batchError.replies.map((reply, index) => (errorIndexes.has(index) ? [reply as Error, null] : [null, reply]));
  }
  return [[error as Error, null]];
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
    protected readonly isCluster: boolean = false,
  ) {}

  async exec(): Promise<Array<[Error | null, unknown]>> {
    const multi = (this.client as RedisClientType).multi();

    for (const { command, args } of this.commands) {
      const commandArgs = [command, ...args.map(String)];
      if (this.isCluster) {
        // Cluster multi signature: addCommand(firstKey, isReadonly, args) —
        // the single-client single-argument shape leaves args undefined and
        // the whole batch rejects at exec. The first argument after the
        // command name is the (already prefixed) key for slot routing.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (multi as any).addCommand(commandArgs[1], false, commandArgs);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (multi as any).addCommand(commandArgs);
      }
    }

    try {
      const results = await multi.exec();
      return (results as unknown[]).map((result) => [null, result]);
    } catch (error) {
      return mapBatchError(error);
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
  constructor(client: RedisClientType | RedisClusterType, keyPrefix: string = '', isCluster: boolean = false) {
    super(client, keyPrefix, isCluster);
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
        // Sentinel multi signature: addCommand(isReadonly, args) — the
        // single-argument shape leaves args undefined and exec rejects.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (multi as any).addCommand(false, [command, ...args.map(String)]);
      }

      try {
        const results = await multi.exec();
        return (results as unknown[]).map((result) => [null, result] as [Error | null, unknown]);
      } catch (error) {
        return mapBatchError(error);
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
