/**
 * Public option and data types for the session plugin.
 */

/**
 * Request-scoped activity attributes stamped onto a session's metadata.
 */
export interface ISessionActivity {
  /** Client IP address. */
  ip?: string;
  /** Client user agent string. */
  userAgent?: string;
}

/**
 * Plugin-owned metadata stored next to the middleware payload.
 * All timestamps are epoch milliseconds.
 */
export interface ISessionMetadata {
  /** User the session belongs to (via `userIdExtractor`); absent for anonymous sessions. */
  userId?: string;
  /** Last stamped client IP (requires activity stamping). */
  ip?: string;
  /** Last stamped user agent (requires activity stamping). */
  userAgent?: string;
  /** When the session was first written. Survives re-saves. */
  createdAt: number;
  /** Last write or touch (sliding activity marker). */
  lastSeenAt: number;
  /** When the session expires under the current TTL. */
  expiresAt: number;
}

/**
 * A session as seen by the introspection API: middleware payload + metadata.
 *
 * `metadata` is `null` for payloads written outside this store (defensive; a
 * healthy session written by this plugin always has metadata).
 */
export interface ISessionInfo<T = unknown> {
  /** Session ID (the middleware `sid`). */
  id: string;
  /** Parsed middleware payload. */
  data: T;
  /** Plugin-owned metadata, or null when absent. */
  metadata: ISessionMetadata | null;
}

/**
 * What to do when a user would exceed `maxSessionsPerUser`.
 * - `reject` — refuse the new session (`SessionLimitExceededError`)
 * - `evict-oldest` — destroy the oldest sessions (by `createdAt`) over the limit
 */
export type SessionLimitPolicy = 'reject' | 'evict-oldest';

/**
 * Why a session was removed from the store.
 */
export type SessionEndReason = 'destroyed' | 'revoked' | 'expired-by-cap';

/**
 * Payload passed to every lifecycle event callback.
 */
export interface ISessionEventInfo {
  /** Session ID. */
  sessionId: string;
  /** Owning user, when known. */
  userId?: string;
}

/**
 * Lifecycle event callbacks (audit-log hooks).
 * Callbacks are fire-and-forget: failures are logged and never break the request.
 */
export interface ISessionEvents {
  /** A session was written for the first time. */
  onCreated?: (info: ISessionEventInfo) => void | Promise<void>;
  /** A session was destroyed through the middleware (logout / expiry handling). */
  onDestroyed?: (info: ISessionEventInfo) => void | Promise<void>;
  /** A session was revoked via the service API or evicted by a seat limit. */
  onRevoked?: (info: ISessionEventInfo) => void | Promise<void>;
  /** A session was removed because it outlived `absoluteLifetimeMs`. */
  onExpiredByCap?: (info: ISessionEventInfo) => void | Promise<void>;
}

/**
 * Session plugin options.
 */
export interface ISessionPluginOptions {
  /**
   * Make the module global.
   * @default false
   */
  isGlobal?: boolean;

  /**
   * Named Redis client to use.
   * @default 'default'
   */
  client?: string;

  /**
   * Key prefix in Redis.
   * @default 'sess:'
   */
  keyPrefix?: string;

  /**
   * TTL (ms) used when the middleware provides no cookie expiry.
   * @default 86_400_000 (1 day)
   */
  defaultTtlMs?: number;

  /**
   * Extracts the owning user's ID from the raw session payload.
   * Sessions without a user ID are stored but not indexed per-user.
   * @default reads `session.passport.user` (Passport convention)
   */
  userIdExtractor?: (session: unknown) => string | undefined;

  /**
   * Absolute lifetime cap (ms): a session older than this is destroyed on the
   * next read/touch regardless of activity (PCI DSS / OWASP re-login policies).
   * Idle timeout stays the middleware's job; this cap is what the middleware
   * alone cannot enforce.
   * @default undefined (disabled)
   */
  absoluteLifetimeMs?: number;

  /**
   * Maximum concurrent sessions per user (seat limit).
   * Enforced when a session is first indexed for a user (e.g. at login).
   * @default undefined (disabled)
   */
  maxSessionsPerUser?: number;

  /**
   * Policy applied when `maxSessionsPerUser` would be exceeded.
   * @default 'evict-oldest'
   */
  maxSessionsPolicy?: SessionLimitPolicy;

  /**
   * Lifecycle event callbacks (audit-log hooks).
   */
  events?: ISessionEvents;
}

/**
 * Options for a single store write/touch.
 */
export interface ISessionSetOptions {
  /**
   * TTL (ms) for this write; falls back to the plugin `defaultTtlMs`.
   */
  ttlMs?: number;
}

// Type aliases for backward compatibility (non-I-prefixed)
export type SessionPluginOptions = ISessionPluginOptions;
