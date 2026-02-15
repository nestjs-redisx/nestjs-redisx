import { RedisXError } from './base.error';
import { ErrorCode } from './error-codes';

/**
 * Base class for all Redis operation errors.
 *
 * Provides common context for operation failures including
 * command name and arguments.
 */
export class RedisOperationError extends RedisXError {
  constructor(
    message: string,
    code: ErrorCode,
    public readonly command?: string,
    cause?: Error,
    context?: Record<string, unknown>,
  ) {
    super(message, code, cause, {
      ...context,
      command,
    });
  }

  /**
   * Creates operation error with default code.
   */
  static create(message: string, command?: string, cause?: Error): RedisOperationError {
    return new RedisOperationError(message, ErrorCode.OP_FAILED, command, cause);
  }

  /**
   * Creates operation error from command and arguments.
   */
  static fromCommand(command: string, args: unknown[], cause?: Error): RedisOperationError {
    return new RedisOperationError(`Command "${command}" failed: ${cause?.message ?? 'Unknown error'}`, ErrorCode.OP_FAILED, command, cause, { argsCount: args.length });
  }
}

/**
 * Error thrown when Redis key is not found.
 *
 * Used for operations that require a key to exist.
 *
 * @example
 * ```typescript
 * const value = await redis.get('user:123');
 * if (!value) {
 *   throw new RedisKeyNotFoundError('user:123', 'GET');
 * }
 * ```
 */
export class RedisKeyNotFoundError extends RedisOperationError {
  constructor(
    public readonly key: string,
    command?: string,
    cause?: Error,
  ) {
    super(`Key "${key}" not found`, ErrorCode.OP_KEY_NOT_FOUND, command, cause, { key });
  }
}

/**
 * Error thrown when Redis value type doesn't match expected type.
 *
 * For example, trying to LPUSH to a string value.
 *
 * @example
 * ```typescript
 * // Trying to use list command on a string
 * throw new RedisTypeMismatchError(
 *   'mykey',
 *   'list',
 *   'string',
 *   'LPUSH',
 * );
 * ```
 */
export class RedisTypeMismatchError extends RedisOperationError {
  constructor(
    public readonly key: string,
    public readonly expected: string,
    public readonly actual: string,
    command?: string,
    cause?: Error,
  ) {
    super(`Type mismatch for key "${key}": expected ${expected}, got ${actual}`, ErrorCode.OP_TYPE_MISMATCH, command, cause, { key, expected, actual });
  }

  /**
   * Creates type mismatch from Redis WRONGTYPE error.
   */
  static fromRedisError(key: string, command: string, cause: Error): RedisTypeMismatchError {
    // Try to parse expected/actual types from error message
    const message = cause.message.toLowerCase();
    let expected = 'unknown';
    const actual = 'unknown';

    // Redis error format: "WRONGTYPE Operation against a key holding the wrong kind of value"
    if (message.includes('wrongtype')) {
      // Try to infer from command
      if (command.startsWith('L') || command.startsWith('R') || command.startsWith('BLPOP')) {
        expected = 'list';
      } else if (command.startsWith('S') && !command.startsWith('SET')) {
        expected = 'set';
      } else if (command.startsWith('Z')) {
        expected = 'zset';
      } else if (command.startsWith('H')) {
        expected = 'hash';
      }
    }

    return new RedisTypeMismatchError(key, expected, actual, command, cause);
  }
}

/**
 * Error thrown when Redis Lua script execution fails.
 *
 * Includes script SHA and error details for debugging.
 *
 * @example
 * ```typescript
 * throw new RedisScriptError(
 *   'Script execution failed: division by zero',
 *   'abc123...',
 *   originalError,
 *   { line: 42 },
 * );
 * ```
 */
export class RedisScriptError extends RedisOperationError {
  constructor(
    message: string,
    public readonly scriptSha?: string,
    cause?: Error,
    context?: Record<string, unknown>,
  ) {
    super(message, ErrorCode.OP_SCRIPT_ERROR, 'EVALSHA', cause, {
      ...context,
      scriptSha,
    });
  }

  /**
   * Creates script timeout error.
   */
  static timeout(timeoutMs: number, scriptSha?: string): RedisScriptError {
    return new RedisScriptError(`Script execution timed out after ${timeoutMs}ms`, scriptSha, undefined, { timeoutMs });
  }

  /**
   * Creates script not found error (NOSCRIPT).
   */
  static notFound(scriptSha: string): RedisScriptError {
    return new RedisScriptError(`Script not found in Redis cache: ${scriptSha}`, scriptSha, undefined, { reason: 'NOSCRIPT' });
  }
}

/**
 * Error thrown when Redis transaction (MULTI/EXEC) fails.
 *
 * @example
 * ```typescript
 * throw new RedisTransactionError(
 *   'Transaction aborted due to WATCH key modification',
 *   originalError,
 * );
 * ```
 */
export class RedisTransactionError extends RedisOperationError {
  constructor(message: string, cause?: Error, context?: Record<string, unknown>) {
    super(message, ErrorCode.OP_TRANSACTION_FAILED, 'EXEC', cause, context);
  }

  /**
   * Creates transaction aborted error (WATCH failure).
   */
  static aborted(): RedisTransactionError {
    return new RedisTransactionError('Transaction aborted: watched key was modified', undefined, { reason: 'WATCH' });
  }
}

/**
 * Error thrown when Redis pipeline execution fails.
 *
 * @example
 * ```typescript
 * throw new RedisPipelineError(
 *   'Pipeline execution failed: 3 of 10 commands failed',
 *   10,
 *   3,
 *   originalError,
 * );
 * ```
 */
export class RedisPipelineError extends RedisOperationError {
  constructor(
    message: string,
    public readonly totalCommands: number,
    public readonly failedCommands: number,
    cause?: Error,
  ) {
    super(message, ErrorCode.OP_PIPELINE_FAILED, 'PIPELINE', cause, { totalCommands, failedCommands });
  }
}

/**
 * Error thrown when operation has invalid arguments.
 *
 * @example
 * ```typescript
 * throw new RedisInvalidArgsError(
 *   'SET',
 *   'TTL must be a positive number',
 *   { ttl: -1 },
 * );
 * ```
 */
export class RedisInvalidArgsError extends RedisOperationError {
  constructor(
    command: string,
    reason: string,
    public readonly args?: Record<string, unknown>,
  ) {
    super(`Invalid arguments for ${command}: ${reason}`, ErrorCode.OP_INVALID_ARGS, command, undefined, { args, reason });
  }
}

/**
 * Error thrown when Redis returns out of memory error.
 *
 * @example
 * ```typescript
 * throw new RedisOutOfMemoryError('SET', 'user:123');
 * ```
 */
export class RedisOutOfMemoryError extends RedisOperationError {
  constructor(
    command: string,
    public readonly key?: string,
    cause?: Error,
  ) {
    super(`Redis out of memory while executing ${command}${key ? ` on key "${key}"` : ''}`, ErrorCode.OP_OUT_OF_MEMORY, command, cause, { key });
  }
}

/**
 * Error thrown when attempting to write to a read-only replica.
 *
 * @example
 * ```typescript
 * throw new RedisReadOnlyError('SET', 'user:123');
 * ```
 */
export class RedisReadOnlyError extends RedisOperationError {
  constructor(
    command: string,
    public readonly key?: string,
    cause?: Error,
  ) {
    super(`Cannot write to read-only replica: ${command}${key ? ` (key: ${key})` : ''}`, ErrorCode.OP_READONLY, command, cause, { key });
  }
}

/**
 * Error thrown when operation is not supported by current driver.
 *
 * @example
 * ```typescript
 * throw new RedisNotSupportedError(
 *   'GEOSEARCH',
 *   'Requires Redis 6.2+',
 * );
 * ```
 */
export class RedisNotSupportedError extends RedisOperationError {
  constructor(
    command: string,
    public readonly reason: string,
  ) {
    super(`Command ${command} not supported: ${reason}`, ErrorCode.OP_NOT_SUPPORTED, command, undefined, { reason });
  }
}

/**
 * Error thrown when driver is not connected.
 *
 * @example
 * ```typescript
 * if (!this.isConnected()) {
 *   throw new RedisNotConnectedError('GET');
 * }
 * ```
 */
export class RedisNotConnectedError extends RedisOperationError {
  constructor(command?: string) {
    super(`Cannot execute ${command ?? 'operation'}: driver not connected`, ErrorCode.OP_NOT_CONNECTED, command);
  }
}
