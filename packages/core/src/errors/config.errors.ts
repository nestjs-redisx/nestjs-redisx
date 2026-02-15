import { RedisXError } from './base.error';
import { ErrorCode } from './error-codes';

/**
 * Base class for all configuration errors.
 *
 * Thrown during module initialization when configuration is invalid.
 */
export class RedisConfigError extends RedisXError {
  constructor(message: string, code: ErrorCode, cause?: Error, context?: Record<string, unknown>) {
    super(message, code, cause, context);
  }

  /**
   * Creates generic config error.
   */
  static create(message: string, cause?: Error, context?: Record<string, unknown>): RedisConfigError {
    return new RedisConfigError(message, ErrorCode.CFG_INVALID, cause, context);
  }

  /**
   * Creates missing required field error.
   */
  static missingRequired(field: string, parent?: string): RedisConfigError {
    const path = parent ? `${parent}.${field}` : field;
    return new RedisConfigError(`Missing required configuration field: ${path}`, ErrorCode.CFG_MISSING_REQUIRED, undefined, { field, parent, path });
  }

  /**
   * Creates invalid connection type error.
   */
  static invalidConnectionType(type: string, validTypes: string[]): RedisConfigError {
    return new RedisConfigError(`Invalid connection type "${type}". Must be one of: ${validTypes.join(', ')}`, ErrorCode.CFG_INVALID_CONNECTION_TYPE, undefined, { type, validTypes });
  }

  /**
   * Creates invalid host/port error.
   */
  static invalidHostPort(host?: string, port?: number, reason?: string): RedisConfigError {
    const message = reason ? `Invalid host/port configuration: ${reason}` : `Invalid host "${host}" or port "${port}"`;

    return new RedisConfigError(message, ErrorCode.CFG_INVALID_HOST_PORT, undefined, { host, port, reason });
  }

  /**
   * Creates invalid database number error.
   */
  static invalidDb(db: number, max: number = 15): RedisConfigError {
    return new RedisConfigError(`Invalid database number ${db}. Must be between 0 and ${max}`, ErrorCode.CFG_INVALID_DB, undefined, { db, max });
  }

  /**
   * Creates invalid TTL error.
   */
  static invalidTTL(ttl: number, reason?: string): RedisConfigError {
    const message = reason ? `Invalid TTL ${ttl}: ${reason}` : `Invalid TTL ${ttl}. Must be a positive number`;

    return new RedisConfigError(message, ErrorCode.CFG_INVALID_TTL, undefined, { ttl, reason });
  }

  /**
   * Creates invalid timeout error.
   */
  static invalidTimeout(timeout: number, field: string, reason?: string): RedisConfigError {
    const message = reason ? `Invalid ${field} timeout ${timeout}: ${reason}` : `Invalid ${field} timeout ${timeout}. Must be a positive number`;

    return new RedisConfigError(message, ErrorCode.CFG_INVALID_TIMEOUT, undefined, { timeout, field, reason });
  }

  /**
   * Creates invalid retry configuration error.
   */
  static invalidRetry(reason: string, context?: Record<string, unknown>): RedisConfigError {
    return new RedisConfigError(`Invalid retry configuration: ${reason}`, ErrorCode.CFG_INVALID_RETRY, undefined, context);
  }

  /**
   * Creates incompatible configuration error.
   */
  static incompatible(option1: string, option2: string, reason?: string): RedisConfigError {
    const message = reason ? `Incompatible configuration: ${option1} and ${option2} - ${reason}` : `Configuration options "${option1}" and "${option2}" are incompatible`;

    return new RedisConfigError(message, ErrorCode.CFG_INCOMPATIBLE, undefined, { option1, option2, reason });
  }

  /**
   * Creates driver not supported error.
   */
  static driverNotSupported(driver: string, supportedDrivers: string[]): RedisConfigError {
    return new RedisConfigError(`Driver "${driver}" is not supported. Available drivers: ${supportedDrivers.join(', ')}`, ErrorCode.CFG_DRIVER_NOT_SUPPORTED, undefined, { driver, supportedDrivers });
  }

  /**
   * Creates invalid cluster nodes error.
   */
  static invalidClusterNodes(reason: string, nodes?: Array<{ host: string; port: number }>): RedisConfigError {
    return new RedisConfigError(`Invalid cluster nodes configuration: ${reason}`, ErrorCode.CFG_INVALID_CLUSTER_NODES, undefined, { reason, nodes, nodeCount: nodes?.length });
  }

  /**
   * Creates invalid sentinel configuration error.
   */
  static invalidSentinel(reason: string, context?: Record<string, unknown>): RedisConfigError {
    return new RedisConfigError(`Invalid sentinel configuration: ${reason}`, ErrorCode.CFG_INVALID_SENTINEL, undefined, context);
  }

  /**
   * Creates invalid TLS configuration error.
   */
  static invalidTLS(reason: string, context?: Record<string, unknown>): RedisConfigError {
    return new RedisConfigError(`Invalid TLS configuration: ${reason}`, ErrorCode.CFG_INVALID_TLS, undefined, context);
  }
}

/**
 * Error thrown when configuration validation fails.
 *
 * Used for complex validation rules and schema validation.
 *
 * @example
 * ```typescript
 * throw new RedisValidationError(
 *   'clients',
 *   [
 *     { field: 'host', message: 'Host is required' },
 *     { field: 'port', message: 'Port must be between 1 and 65535' },
 *   ],
 * );
 * ```
 */
export class RedisValidationError extends RedisConfigError {
  constructor(
    public readonly field: string,
    public readonly errors: Array<{
      field: string;
      message: string;
      value?: unknown;
    }>,
    cause?: Error,
  ) {
    const errorMessages = errors.map((e) => `${e.field}: ${e.message}`).join('; ');

    super(`Validation failed for "${field}": ${errorMessages}`, ErrorCode.CFG_VALIDATION_FAILED, cause, { field, errors, errorCount: errors.length });
  }

  /**
   * Creates validation error from single field.
   */
  static single(field: string, message: string, value?: unknown): RedisValidationError {
    return new RedisValidationError(field, [{ field, message, value }]);
  }

  /**
   * Creates validation error from multiple fields.
   */
  static multiple(parent: string, errors: Array<{ field: string; message: string; value?: unknown }>): RedisValidationError {
    return new RedisValidationError(parent, errors);
  }

  /**
   * Adds a validation error to the list.
   */
  addError(field: string, message: string, value?: unknown): this {
    this.errors.push({ field, message, value });
    return this;
  }

  /**
   * Checks if validation has errors.
   */
  hasErrors(): boolean {
    return this.errors.length > 0;
  }

  /**
   * Gets all error messages.
   */
  getMessages(): string[] {
    return this.errors.map((e) => `${e.field}: ${e.message}`);
  }

  /**
   * Gets errors for specific field.
   */
  getFieldErrors(field: string): Array<{ field: string; message: string; value?: unknown }> {
    return this.errors.filter((e) => e.field === field);
  }
}

/**
 * Validation error collector for building up multiple validation errors.
 *
 * @example
 * ```typescript
 * const validator = new ValidationErrorCollector('connectionConfig');
 *
 * if (!config.host) {
 *   validator.add('host', 'Host is required');
 * }
 *
 * if (config.port < 1 || config.port > 65535) {
 *   validator.add('port', 'Port must be between 1 and 65535', config.port);
 * }
 *
 * validator.throwIfErrors();
 * ```
 */
export class ValidationErrorCollector {
  private errors: Array<{
    field: string;
    message: string;
    value?: unknown;
  }> = [];

  constructor(private readonly parent: string) {}

  /**
   * Adds a validation error.
   */
  add(field: string, message: string, value?: unknown): this {
    this.errors.push({ field, message, value });
    return this;
  }

  /**
   * Checks if there are any errors.
   */
  hasErrors(): boolean {
    return this.errors.length > 0;
  }

  /**
   * Gets error count.
   */
  count(): number {
    return this.errors.length;
  }

  /**
   * Throws if there are any errors.
   */
  throwIfErrors(): void {
    if (this.hasErrors()) {
      throw new RedisValidationError(this.parent, this.errors);
    }
  }

  /**
   * Gets all errors.
   */
  getErrors(): Array<{ field: string; message: string; value?: unknown }> {
    return [...this.errors];
  }

  /**
   * Clears all errors.
   */
  clear(): void {
    this.errors = [];
  }
}
