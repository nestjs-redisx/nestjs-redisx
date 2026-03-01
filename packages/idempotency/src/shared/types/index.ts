import { ExecutionContext } from '@nestjs/common';

/**
 * Idempotency plugin configuration options
 */
export interface IIdempotencyPluginOptions {
  /**
   * Make the module global.
   * @default false
   */
  isGlobal?: boolean;

  /** Named Redis client to use. @default 'default' */
  client?: string;

  /** Default TTL for idempotency records in seconds. @default 86400 (24 hours) */
  defaultTtl?: number;

  /** Key prefix in Redis. @default 'idempotency:' */
  keyPrefix?: string;

  /** Header name for idempotency key. @default 'Idempotency-Key' */
  headerName?: string;

  /** Lock timeout while processing in ms. @default 30000 (30 seconds) */
  lockTimeout?: number;

  /** Timeout waiting for concurrent request in ms. @default 60000 (60 seconds) */
  waitTimeout?: number;

  /** Whether to validate request fingerprint. @default true */
  validateFingerprint?: boolean;

  /** Fields to include in fingerprint. @default ['method', 'path', 'body'] */
  fingerprintFields?: ('method' | 'path' | 'body' | 'query' | 'headers')[];

  /** Custom fingerprint generator */
  fingerprintGenerator?: (context: ExecutionContext) => string | Promise<string>;

  /** Error handling strategy. @default 'fail-closed' */
  errorPolicy?: 'fail-open' | 'fail-closed';
}

/**
 * Idempotency record stored in Redis
 */
export interface IIdempotencyRecord {
  /** Idempotency key */
  key: string;

  /** Request fingerprint hash */
  fingerprint: string;

  /** Current status */
  status: 'processing' | 'completed' | 'failed';

  /** HTTP status code */
  statusCode?: number;

  /** Response body (JSON string) */
  response?: string;

  /** Response headers to replay (JSON string) */
  headers?: string;

  /** When processing started (timestamp ms) */
  startedAt: number;

  /** When completed (timestamp ms) */
  completedAt?: number;

  /** Error message if failed */
  error?: string;
}

/**
 * Result of checking idempotency key
 */
export interface IIdempotencyCheckResult {
  /** Whether this is a new request */
  isNew: boolean;

  /** If duplicate, the stored record */
  record?: IIdempotencyRecord;

  /** If fingerprint mismatch */
  fingerprintMismatch?: boolean;
}

/**
 * Response data to store
 */
export interface IIdempotencyResponse {
  statusCode: number;
  body: unknown;
  headers?: Record<string, string>;
}

/**
 * Options for idempotency operations
 */
export interface IIdempotencyOptions {
  ttl?: number;
  lockTimeout?: number;
}
