/**
 * Driver-specific error classes with simplified constructors.
 * Used internally by driver adapters (ioredis, node-redis).
 */

import { RedisConnectionError, RedisTimeoutError as RedisTimeoutErrorNew, RedisOperationError } from '../../errors';
import { ErrorCode } from '../../errors/error-codes';

/**
 * Base class for driver-related errors.
 */
export class DriverError extends RedisConnectionError {
  constructor(message: string, code: ErrorCode, cause?: Error, context?: Record<string, unknown>) {
    super(message, code, undefined, undefined, cause, context);
  }
}

/**
 * Error thrown when connection to Redis fails.
 */
export class ConnectionError extends RedisConnectionError {
  constructor(
    message: string,
    cause?: Error,
    public override readonly host?: string,
    public override readonly port?: number,
  ) {
    super(message, ErrorCode.CONN_FAILED, host, port, cause);
  }
}

/**
 * Error thrown when operation times out.
 */
export class TimeoutError extends RedisTimeoutErrorNew {
  constructor(operation: string, timeoutMs: number, cause?: Error) {
    super(operation, timeoutMs, undefined, undefined, cause);
  }
}

/**
 * Error thrown when Redis command fails.
 */
export class CommandError extends RedisOperationError {
  public override readonly command: string;
  public readonly args: unknown[];

  constructor(command: string, args: unknown[], cause?: Error) {
    const message = `Command "${command}" failed: ${cause?.message ?? 'Unknown error'}`;
    super(message, ErrorCode.OP_FAILED, command, cause, { argsCount: args.length });

    this.command = command;
    this.args = args;
  }
}
