/**
 * Error handling system for NestJS RedisX.
 *
 * Provides a comprehensive error hierarchy with:
 * - Structured error codes for programmatic handling
 * - Rich context for debugging
 * - JSON serialization for logging
 * - Proper error chaining
 *
 * @module errors
 */

export { RedisXError, type IErrorJSON } from './base.error';

export { ErrorCode, isErrorCode, getErrorDomain, isErrorDomain } from './error-codes';

export { RedisConnectionError, RedisTimeoutError, RedisClusterError, RedisSentinelError, RedisAuthError, RedisTLSError, RedisMaxRetriesError, RedisPoolExhaustedError } from './connection.errors';

export { RedisOperationError, RedisKeyNotFoundError, RedisTypeMismatchError, RedisScriptError, RedisTransactionError, RedisPipelineError, RedisInvalidArgsError, RedisOutOfMemoryError, RedisReadOnlyError, RedisNotSupportedError, RedisNotConnectedError } from './operation.errors';

export { RedisConfigError, RedisValidationError, ValidationErrorCollector } from './config.errors';
