import { RedisXError } from './base.error';
import { ErrorCode } from './error-codes';

/**
 * Base class for all connection-related errors.
 *
 * Provides common context for connection failures including
 * host, port, and connection type information.
 */
export class RedisConnectionError extends RedisXError {
  constructor(
    message: string,
    code: ErrorCode,
    public readonly host?: string,
    public readonly port?: number,
    cause?: Error,
    context?: Record<string, unknown>,
  ) {
    super(message, code, cause, {
      ...context,
      host,
      port,
    });
  }

  /**
   * Creates connection error with default code.
   */
  static create(message: string, host?: string, port?: number, cause?: Error): RedisConnectionError {
    return new RedisConnectionError(message, ErrorCode.CONN_FAILED, host, port, cause);
  }
}

/**
 * Error thrown when connection or operation times out.
 *
 * Includes timeout duration and operation details for debugging.
 *
 * @example
 * ```typescript
 * throw new RedisTimeoutError(
 *   'Connection',
 *   5000,
 *   'localhost',
 *   6379,
 * );
 * ```
 */
export class RedisTimeoutError extends RedisConnectionError {
  constructor(
    public readonly operation: string,
    public readonly timeoutMs: number,
    host?: string,
    port?: number,
    cause?: Error,
  ) {
    const message = operation === 'Connection' ? `Connection to ${host}:${port} timed out after ${timeoutMs}ms` : `Operation "${operation}" timed out after ${timeoutMs}ms`;

    super(message, operation === 'Connection' ? ErrorCode.CONN_TIMEOUT : ErrorCode.OP_TIMEOUT, host, port, cause, { operation, timeoutMs });
  }
}

/**
 * Error thrown for Redis Cluster-specific failures.
 *
 * Handles cluster slot redirections (MOVED, ASK), cluster down states,
 * and other cluster topology issues.
 *
 * @example
 * ```typescript
 * // Cluster down
 * throw new RedisClusterError(
 *   'Cluster is down',
 *   ErrorCode.CONN_CLUSTER_DOWN,
 * );
 *
 * // Slot migration
 * throw new RedisClusterError(
 *   'Key moved to different slot',
 *   ErrorCode.CONN_CLUSTER_MOVED,
 *   undefined,
 *   undefined,
 *   undefined,
 *   { slot: 1234, targetNode: 'node2:7001' },
 * );
 * ```
 */
export class RedisClusterError extends RedisConnectionError {
  constructor(message: string, code: ErrorCode, host?: string, port?: number, cause?: Error, context?: Record<string, unknown>) {
    super(message, code, host, port, cause, context);
  }

  /**
   * Creates cluster down error.
   */
  static clusterDown(host?: string, port?: number): RedisClusterError {
    return new RedisClusterError('Redis cluster is down or unreachable', ErrorCode.CONN_CLUSTER_DOWN, host, port);
  }

  /**
   * Creates MOVED redirection error.
   */
  static moved(slot: number, targetHost: string, targetPort: number, cause?: Error): RedisClusterError {
    return new RedisClusterError(`Slot ${slot} moved to ${targetHost}:${targetPort}`, ErrorCode.CONN_CLUSTER_MOVED, targetHost, targetPort, cause, { slot, targetHost, targetPort });
  }

  /**
   * Creates ASK redirection error.
   */
  static ask(slot: number, targetHost: string, targetPort: number, cause?: Error): RedisClusterError {
    return new RedisClusterError(`ASK redirection for slot ${slot} to ${targetHost}:${targetPort}`, ErrorCode.CONN_CLUSTER_ASK, targetHost, targetPort, cause, { slot, targetHost, targetPort });
  }

  /**
   * Creates generic cluster error.
   */
  static generic(message: string, host?: string, port?: number, cause?: Error): RedisClusterError {
    return new RedisClusterError(message, ErrorCode.CONN_CLUSTER_ERROR, host, port, cause);
  }
}

/**
 * Error thrown for Redis Sentinel-specific failures.
 *
 * Handles sentinel master discovery, failover events, and sentinel
 * connectivity issues.
 *
 * @example
 * ```typescript
 * // No master found
 * throw RedisSentinelError.noMaster('mymaster', [
 *   { host: 'sentinel1', port: 26379 },
 *   { host: 'sentinel2', port: 26379 },
 * ]);
 *
 * // Failover in progress
 * throw RedisSentinelError.failover(
 *   'mymaster',
 *   'old-master:6379',
 *   'new-master:6379',
 * );
 * ```
 */
export class RedisSentinelError extends RedisConnectionError {
  constructor(
    message: string,
    code: ErrorCode,
    public readonly masterName?: string,
    host?: string,
    port?: number,
    cause?: Error,
    context?: Record<string, unknown>,
  ) {
    super(message, code, host, port, cause, {
      ...context,
      masterName,
    });
  }

  /**
   * Creates no master found error.
   */
  static noMaster(masterName: string, sentinels?: Array<{ host: string; port: number }>): RedisSentinelError {
    return new RedisSentinelError(`No master found for "${masterName}"`, ErrorCode.CONN_SENTINEL_NO_MASTER, masterName, undefined, undefined, undefined, { sentinels });
  }

  /**
   * Creates sentinel failover error.
   */
  static failover(masterName: string, oldMaster?: string, newMaster?: string): RedisSentinelError {
    return new RedisSentinelError(`Sentinel failover in progress for "${masterName}"`, ErrorCode.CONN_SENTINEL_FAILOVER, masterName, undefined, undefined, undefined, { oldMaster, newMaster });
  }

  /**
   * Creates generic sentinel error.
   */
  static generic(message: string, masterName?: string, cause?: Error): RedisSentinelError {
    return new RedisSentinelError(message, ErrorCode.CONN_SENTINEL_ERROR, masterName, undefined, undefined, cause);
  }
}

/**
 * Error thrown when authentication fails.
 *
 * @example
 * ```typescript
 * throw new RedisAuthError('Invalid password', 'localhost', 6379);
 * ```
 */
export class RedisAuthError extends RedisConnectionError {
  constructor(message: string = 'Redis authentication failed', host?: string, port?: number, cause?: Error) {
    super(message, ErrorCode.CONN_AUTH_FAILED, host, port, cause);
  }
}

/**
 * Error thrown when TLS/SSL connection fails.
 *
 * @example
 * ```typescript
 * throw new RedisTLSError(
 *   'Certificate verification failed',
 *   'secure.redis.example.com',
 *   6380,
 *   originalError,
 * );
 * ```
 */
export class RedisTLSError extends RedisConnectionError {
  constructor(message: string = 'TLS/SSL connection failed', host?: string, port?: number, cause?: Error) {
    super(message, ErrorCode.CONN_TLS_ERROR, host, port, cause);
  }
}

/**
 * Error thrown when maximum connection retries exceeded.
 *
 * @example
 * ```typescript
 * throw new RedisMaxRetriesError(
 *   5,
 *   'localhost',
 *   6379,
 *   lastError,
 * );
 * ```
 */
export class RedisMaxRetriesError extends RedisConnectionError {
  constructor(
    public readonly maxRetries: number,
    host?: string,
    port?: number,
    cause?: Error,
  ) {
    super(`Maximum connection retries (${maxRetries}) exceeded`, ErrorCode.CONN_MAX_RETRIES, host, port, cause, { maxRetries });
  }
}

/**
 * Error thrown when connection pool is exhausted.
 *
 * @example
 * ```typescript
 * throw new RedisPoolExhaustedError(10, 100);
 * ```
 */
export class RedisPoolExhaustedError extends RedisConnectionError {
  constructor(
    public readonly poolSize: number,
    public readonly waitingClients: number,
    cause?: Error,
  ) {
    super(`Connection pool exhausted (size: ${poolSize}, waiting: ${waitingClients})`, ErrorCode.CONN_POOL_EXHAUSTED, undefined, undefined, cause, { poolSize, waitingClients });
  }
}
