import { ErrorCode } from './error-codes';

/**
 * JSON representation of an error.
 * Used for serialization in logs and API responses.
 */
export interface IErrorJSON {
  /** Error class name */
  name: string;
  /** Human-readable error message */
  message: string;
  /** Error code for programmatic handling */
  code: string;
  /** ISO timestamp when error occurred */
  timestamp: string;
  /** Additional context for debugging */
  context?: Record<string, unknown>;
  /** Stack trace */
  stack?: string;
  /** Cause error if wrapped */
  cause?: {
    name: string;
    message: string;
    stack?: string;
  };
}

/**
 * Base error class for all RedisX errors.
 *
 * Features:
 * - Structured error codes for programmatic handling
 * - Context preservation for debugging
 * - JSON serialization for logging
 * - Proper error chaining with cause
 * - Timestamp tracking
 *
 * While this class can be instantiated directly, it's recommended
 * to use or extend specific error classes for better error handling.
 *
 * @example
 * ```typescript
 * export class CacheError extends RedisXError {
 *   constructor(message: string, cause?: Error) {
 *     super(message, ErrorCode.CACHE_LOADER_FAILED, cause, {
 *       key: 'user:123',
 *       ttl: 3600,
 *     });
 *   }
 * }
 * ```
 */
export class RedisXError extends Error {
  /**
   * Timestamp when error was created.
   */
  public readonly timestamp: Date;

  /**
   * Creates a new RedisXError.
   *
   * @param message - Human-readable error message
   * @param code - Error code for programmatic handling
   * @param cause - Original error that caused this error
   * @param context - Additional context for debugging
   */
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public override readonly cause?: Error,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);

    // Set the prototype explicitly (TypeScript requirement)
    Object.setPrototypeOf(this, new.target.prototype);

    this.name = this.constructor.name;
    this.timestamp = new Date();

    // Capture stack trace, excluding constructor
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Checks if error is of specific code.
   *
   * @param code - Error code to check
   * @returns True if error matches code
   *
   * @example
   * ```typescript
   * if (error.is(ErrorCode.CONN_FAILED)) {
   *   // Handle connection error
   * }
   * ```
   */
  is(code: ErrorCode): boolean {
    return this.code === code;
  }

  /**
   * Checks if error is any of specified codes.
   *
   * @param codes - Array of error codes to check
   * @returns True if error matches any code
   *
   * @example
   * ```typescript
   * if (error.isAnyOf([ErrorCode.LOCK_EXPIRED, ErrorCode.LOCK_NOT_OWNED])) {
   *   // Handle lock error
   * }
   * ```
   */
  isAnyOf(codes: ErrorCode[]): boolean {
    return codes.includes(this.code);
  }

  /**
   * Serializes error to JSON for logging.
   *
   * @returns JSON representation of error
   *
   * @example
   * ```typescript
   * logger.error('Operation failed', error.toJSON());
   * ```
   */
  toJSON(): IErrorJSON {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      timestamp: this.timestamp.toISOString(),
      context: this.context,
      cause: this.cause
        ? {
            name: this.cause.name,
            message: this.cause.message,
            stack: this.cause.stack,
          }
        : undefined,
      stack: this.stack,
    };
  }

  /**
   * Creates error string for logging.
   *
   * @returns Formatted error string
   */
  override toString(): string {
    let str = `${this.name} [${this.code}]: ${this.message}`;

    if (this.cause) {
      str += `\n  Caused by: ${this.cause.message}`;
    }

    if (this.context && Object.keys(this.context).length > 0) {
      str += `\n  Context: ${JSON.stringify(this.context)}`;
    }

    return str;
  }

  /**
   * Wraps unknown error in RedisXError.
   *
   * @param error - Error to wrap
   * @param code - Error code to assign
   * @returns RedisXError instance
   *
   * @example
   * ```typescript
   * try {
   *   await someOperation();
   * } catch (err) {
   *   throw RedisXError.wrap(err, ErrorCode.CACHE_LOADER_FAILED);
   * }
   * ```
   */
  static wrap(error: unknown, code: ErrorCode = ErrorCode.UNKNOWN): RedisXError {
    if (error instanceof RedisXError) {
      return error;
    }

    if (error instanceof Error) {
      return new GenericRedisXError(error.message, code, error);
    }

    return new GenericRedisXError(String(error), code, undefined, { originalError: error });
  }

  /**
   * Checks if value is a RedisXError.
   *
   * @param error - Value to check
   * @returns True if value is RedisXError
   */
  static isRedisXError(error: unknown): error is RedisXError {
    return error instanceof RedisXError;
  }
}

/**
 * Generic RedisX error for wrapping unknown errors.
 * @internal
 */
class GenericRedisXError extends RedisXError {
  constructor(message: string, code: ErrorCode, cause?: Error, context?: Record<string, unknown>) {
    super(message, code, cause, context);
  }
}
