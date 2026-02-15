/**
 * All possible error codes in NestJS RedisX.
 * Organized by domain for easier categorization and handling.
 *
 * Naming convention: {DOMAIN}_{SPECIFIC_ERROR}
 *
 * Domains:
 * - CONN/DRIVER: Connection and networking errors
 * - OP: Redis operation errors
 * - CFG/CONFIG: Configuration and validation errors
 * - LOCK: Distributed lock errors
 * - CACHE: Caching errors
 * - RATE: Rate limiting errors
 * - STREAM: Stream processing errors
 * - PLUGIN: Plugin system errors
 * - IDEMPOTENCY: Idempotency errors
 */
export enum ErrorCode {
  /** Failed to establish connection to Redis server */
  CONN_FAILED = 'CONN_FAILED',

  /** Connection attempt timed out */
  CONN_TIMEOUT = 'CONN_TIMEOUT',

  /** Lost connection to Redis server */
  CONN_DISCONNECTED = 'CONN_DISCONNECTED',

  /** Connection was refused by Redis server */
  CONN_REFUSED = 'CONN_REFUSED',

  /** Authentication failed */
  CONN_AUTH_FAILED = 'CONN_AUTH_FAILED',

  /** TLS/SSL connection error */
  CONN_TLS_ERROR = 'CONN_TLS_ERROR',

  /** Redis cluster is down or unreachable */
  CONN_CLUSTER_DOWN = 'CONN_CLUSTER_DOWN',

  /** Redis cluster slot migration in progress */
  CONN_CLUSTER_MOVED = 'CONN_CLUSTER_MOVED',

  /** Redis cluster ASK redirection */
  CONN_CLUSTER_ASK = 'CONN_CLUSTER_ASK',

  /** Redis cluster error */
  CONN_CLUSTER_ERROR = 'CONN_CLUSTER_ERROR',

  /** Sentinel failover in progress */
  CONN_SENTINEL_FAILOVER = 'CONN_SENTINEL_FAILOVER',

  /** No Sentinel master found */
  CONN_SENTINEL_NO_MASTER = 'CONN_SENTINEL_NO_MASTER',

  /** Sentinel error */
  CONN_SENTINEL_ERROR = 'CONN_SENTINEL_ERROR',

  /** Driver not connected */
  DRIVER_NOT_CONNECTED = 'DRIVER_NOT_CONNECTED',

  /** Maximum connection retries exceeded */
  CONN_MAX_RETRIES = 'CONN_MAX_RETRIES',

  /** Connection pool exhausted */
  CONN_POOL_EXHAUSTED = 'CONN_POOL_EXHAUSTED',

  /** Redis operation failed */
  OP_FAILED = 'OP_FAILED',

  /** Redis operation timed out */
  OP_TIMEOUT = 'OP_TIMEOUT',

  /** Redis key not found */
  OP_KEY_NOT_FOUND = 'OP_KEY_NOT_FOUND',

  /** Wrong Redis data type for operation */
  OP_TYPE_MISMATCH = 'OP_TYPE_MISMATCH',

  /** Redis script execution failed */
  OP_SCRIPT_ERROR = 'OP_SCRIPT_ERROR',

  /** Redis script timeout */
  OP_SCRIPT_TIMEOUT = 'OP_SCRIPT_TIMEOUT',

  /** Redis transaction failed */
  OP_TRANSACTION_FAILED = 'OP_TRANSACTION_FAILED',

  /** Redis pipeline execution failed */
  OP_PIPELINE_FAILED = 'OP_PIPELINE_FAILED',

  /** Invalid operation arguments */
  OP_INVALID_ARGS = 'OP_INVALID_ARGS',

  /** Operation not supported by driver */
  OP_NOT_SUPPORTED = 'OP_NOT_SUPPORTED',

  /** Redis out of memory */
  OP_OUT_OF_MEMORY = 'OP_OUT_OF_MEMORY',

  /** Redis NOAUTH error - authentication required */
  OP_NO_AUTH = 'OP_NO_AUTH',

  /** Redis WRONGPASS error - invalid password */
  OP_WRONG_PASS = 'OP_WRONG_PASS',

  /** Redis READONLY error - can't write to replica */
  OP_READONLY = 'OP_READONLY',

  /** Redis BUSYKEY error - target key already exists */
  OP_BUSY_KEY = 'OP_BUSY_KEY',

  /** Operation requires driver to be connected */
  OP_NOT_CONNECTED = 'OP_NOT_CONNECTED',

  /** Invalid configuration */
  CFG_INVALID = 'CFG_INVALID',

  /** Missing required configuration */
  CFG_MISSING_REQUIRED = 'CFG_MISSING_REQUIRED',

  /** Invalid connection type */
  CFG_INVALID_CONNECTION_TYPE = 'CFG_INVALID_CONNECTION_TYPE',

  /** Invalid host or port */
  CFG_INVALID_HOST_PORT = 'CFG_INVALID_HOST_PORT',

  /** Invalid database number */
  CFG_INVALID_DB = 'CFG_INVALID_DB',

  /** Invalid TTL value */
  CFG_INVALID_TTL = 'CFG_INVALID_TTL',

  /** Invalid timeout value */
  CFG_INVALID_TIMEOUT = 'CFG_INVALID_TIMEOUT',

  /** Invalid retry configuration */
  CFG_INVALID_RETRY = 'CFG_INVALID_RETRY',

  /** Validation failed */
  CFG_VALIDATION_FAILED = 'CFG_VALIDATION_FAILED',

  /** Incompatible configuration options */
  CFG_INCOMPATIBLE = 'CFG_INCOMPATIBLE',

  /** Driver type not supported */
  CFG_DRIVER_NOT_SUPPORTED = 'CFG_DRIVER_NOT_SUPPORTED',

  /** Invalid cluster nodes configuration */
  CFG_INVALID_CLUSTER_NODES = 'CFG_INVALID_CLUSTER_NODES',

  /** Invalid sentinel configuration */
  CFG_INVALID_SENTINEL = 'CFG_INVALID_SENTINEL',

  /** Invalid TLS configuration */
  CFG_INVALID_TLS = 'CFG_INVALID_TLS',

  /** Cache key is invalid */
  CACHE_KEY_INVALID = 'CACHE_KEY_INVALID',

  /** Cache key exceeds maximum length */
  CACHE_KEY_TOO_LONG = 'CACHE_KEY_TOO_LONG',

  /** Failed to serialize value */
  CACHE_SERIALIZATION_FAILED = 'CACHE_SERIALIZATION_FAILED',

  /** Failed to deserialize value */
  CACHE_DESERIALIZATION_FAILED = 'CACHE_DESERIALIZATION_FAILED',

  /** Cache tag index corrupted */
  CACHE_TAG_INDEX_CORRUPTED = 'CACHE_TAG_INDEX_CORRUPTED',

  /** Cache stampede protection timeout */
  CACHE_STAMPEDE_TIMEOUT = 'CACHE_STAMPEDE_TIMEOUT',

  /** Cache loader function failed */
  CACHE_LOADER_FAILED = 'CACHE_LOADER_FAILED',

  /** L1 cache error */
  CACHE_L1_ERROR = 'CACHE_L1_ERROR',

  /** L2 cache error */
  CACHE_L2_ERROR = 'CACHE_L2_ERROR',

  /** Cache set operation failed */
  CACHE_SET_FAILED = 'CACHE_SET_FAILED',

  /** Cache delete operation failed */
  CACHE_DELETE_FAILED = 'CACHE_DELETE_FAILED',

  /** Cache clear operation failed */
  CACHE_CLEAR_FAILED = 'CACHE_CLEAR_FAILED',

  /** Cache operation failed */
  CACHE_OPERATION_FAILED = 'CACHE_OPERATION_FAILED',

  /** Cache operation timeout */
  CACHE_OPERATION_TIMEOUT = 'CACHE_OPERATION_TIMEOUT',

  /** Tag invalidation failed */
  CACHE_TAG_INVALIDATION_FAILED = 'CACHE_TAG_INVALIDATION_FAILED',

  /** Failed to acquire lock */
  LOCK_ACQUISITION_FAILED = 'LOCK_ACQUISITION_FAILED',

  /** Lock acquisition timed out */
  LOCK_ACQUISITION_TIMEOUT = 'LOCK_ACQUISITION_TIMEOUT',

  /** Failed to extend lock TTL */
  LOCK_EXTENSION_FAILED = 'LOCK_EXTENSION_FAILED',

  /** Failed to release lock */
  LOCK_RELEASE_FAILED = 'LOCK_RELEASE_FAILED',

  /** Attempting to release lock not owned by caller */
  LOCK_NOT_OWNED = 'LOCK_NOT_OWNED',

  /** Lock expired before operation completed */
  LOCK_EXPIRED = 'LOCK_EXPIRED',

  /** Rate limit exceeded */
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',

  /** Rate limit script error */
  RATE_LIMIT_SCRIPT_ERROR = 'RATE_LIMIT_SCRIPT_ERROR',

  /** Idempotency key is invalid */
  IDEMPOTENCY_KEY_INVALID = 'IDEMPOTENCY_KEY_INVALID',

  /** Operation already in progress */
  IDEMPOTENCY_IN_PROGRESS = 'IDEMPOTENCY_IN_PROGRESS',

  /** Previous operation failed */
  IDEMPOTENCY_PREVIOUS_FAILED = 'IDEMPOTENCY_PREVIOUS_FAILED',

  /** Consumer group operation failed */
  STREAM_CONSUMER_GROUP_ERROR = 'STREAM_CONSUMER_GROUP_ERROR',

  /** Stream ACK failed */
  STREAM_ACK_FAILED = 'STREAM_ACK_FAILED',

  /** Stream read failed */
  STREAM_READ_FAILED = 'STREAM_READ_FAILED',

  /** Plugin is invalid */
  PLUGIN_INVALID = 'PLUGIN_INVALID',

  /** Plugin already registered */
  PLUGIN_DUPLICATE = 'PLUGIN_DUPLICATE',

  /** Plugin not found */
  PLUGIN_NOT_FOUND = 'PLUGIN_NOT_FOUND',

  /** Plugin registration failed */
  PLUGIN_REGISTER_FAILED = 'PLUGIN_REGISTER_FAILED',

  /** Plugin initialization failed */
  PLUGIN_INIT_FAILED = 'PLUGIN_INIT_FAILED',

  /** Circular plugin dependency */
  PLUGIN_CIRCULAR_DEPENDENCY = 'PLUGIN_CIRCULAR_DEPENDENCY',

  /** Required plugin dependency missing */
  PLUGIN_DEPENDENCY_MISSING = 'PLUGIN_DEPENDENCY_MISSING',

  /** Client not found */
  CLIENT_NOT_FOUND = 'CLIENT_NOT_FOUND',

  /** Client already exists */
  CLIENT_ALREADY_EXISTS = 'CLIENT_ALREADY_EXISTS',

  /** Service not initialized */
  NOT_INITIALIZED = 'NOT_INITIALIZED',

  /** Generic operation failed */
  OPERATION_FAILED = 'OPERATION_FAILED',

  /** Generic operation timeout */
  OPERATION_TIMEOUT = 'OPERATION_TIMEOUT',

  /** Generic serialization failed */
  SERIALIZATION_FAILED = 'SERIALIZATION_FAILED',

  /** Generic validation failed */
  VALIDATION_FAILED = 'VALIDATION_FAILED',

  /** Unknown error */
  UNKNOWN = 'UNKNOWN',
}

/**
 * Type guard to check if a string is a valid ErrorCode.
 */
export function isErrorCode(value: string): value is ErrorCode {
  return Object.values(ErrorCode).includes(value as ErrorCode);
}

/**
 * Get error domain from error code.
 *
 * @param code - Error code
 * @returns Domain prefix (e.g., 'CONN', 'OP', 'CFG')
 *
 * @example
 * ```typescript
 * getErrorDomain(ErrorCode.CONN_FAILED) // 'CONN'
 * getErrorDomain(ErrorCode.OP_TIMEOUT) // 'OP'
 * ```
 */
export function getErrorDomain(code: ErrorCode): string {
  const parts = code.split('_');
  return parts[0] || 'UNKNOWN';
}

/**
 * Check if error code belongs to a domain.
 *
 * @param code - Error code to check
 * @param domain - Domain to check against
 * @returns True if code belongs to domain
 *
 * @example
 * ```typescript
 * isErrorDomain(ErrorCode.CONN_FAILED, 'CONN') // true
 * isErrorDomain(ErrorCode.OP_TIMEOUT, 'CONN') // false
 * ```
 */
export function isErrorDomain(code: ErrorCode, domain: string): boolean {
  return getErrorDomain(code) === domain;
}
