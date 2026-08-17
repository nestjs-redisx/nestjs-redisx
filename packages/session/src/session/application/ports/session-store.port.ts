import { ISessionActivity, ISessionMetadata, ISessionSetOptions, SessionEndReason } from '../../../shared/types';

/**
 * Promise-based session store port.
 *
 * The middleware adapters (`toExpressStore` / `toFastifyStore`) translate the
 * callback contracts of `express-session` / `@fastify/session` onto this port;
 * the session service builds its introspection/revocation API on top of it.
 */
export interface ISessionStore {
  /**
   * Read a session payload.
   * Enforces the absolute lifetime cap: a capped-out session is destroyed and
   * reported as a miss. Corrupt payloads are self-healed the same way.
   *
   * @param sessionId - Middleware session ID
   * @returns Parsed payload, or `null` when absent/expired
   * @throws {SessionStoreError} When the underlying store fails
   */
  get(sessionId: string): Promise<unknown | null>;

  /**
   * Write a session payload (serialized as JSON) plus plugin metadata.
   *
   * - `createdAt` survives re-saves; the TTL is clamped to the remaining
   *   absolute lifetime window.
   * - When `userIdExtractor` yields an ID the session is indexed per-user and
   *   `maxSessionsPerUser` is enforced (`reject` throws; `evict-oldest`
   *   destroys the oldest sessions over the limit).
   *
   * @param sessionId - Middleware session ID
   * @param session - Raw middleware payload
   * @param options - Per-write TTL override
   * @throws {SessionLimitExceededError} Under the `reject` policy at the limit
   * @throws {SessionSerializationError} When the payload is not JSON-serializable
   * @throws {SessionStoreError} When the underlying store fails
   */
  set(sessionId: string, session: unknown, options?: ISessionSetOptions): Promise<void>;

  /**
   * Slide the session TTL (rolling sessions) and refresh `lastSeenAt`.
   * Enforces the absolute lifetime cap.
   *
   * @param sessionId - Middleware session ID
   * @param options - Per-touch TTL override
   * @returns `false` when the session is absent or was expired by the cap
   * @throws {SessionStoreError} When the underlying store fails
   */
  touch(sessionId: string, options?: ISessionSetOptions): Promise<boolean>;

  /**
   * Remove a session (payload, metadata, and index entries).
   *
   * @param sessionId - Middleware session ID
   * @param reason - Why the session ends; drives lifecycle events/metrics
   * @returns `true` when a session existed
   * @throws {SessionStoreError} When the underlying store fails
   */
  destroy(sessionId: string, reason?: SessionEndReason): Promise<boolean>;

  /**
   * Read a session's plugin metadata.
   *
   * @param sessionId - Middleware session ID
   * @returns Metadata, or `null` when absent
   * @throws {SessionStoreError} When the underlying store fails
   */
  getMetadata(sessionId: string): Promise<ISessionMetadata | null>;

  /**
   * Stamp request-scoped activity attributes (IP, user agent) and refresh
   * `lastSeenAt`. No-op for missing sessions.
   *
   * @param sessionId - Middleware session ID
   * @param activity - Attributes to stamp
   * @throws {SessionStoreError} When the underlying store fails
   */
  recordActivity(sessionId: string, activity: ISessionActivity): Promise<void>;

  /**
   * List a user's live session IDs (expired index entries are swept first).
   *
   * @param userId - Owning user
   * @throws {SessionStoreError} When the underlying store fails
   */
  getUserSessionIds(userId: string): Promise<string[]>;

  /**
   * Count all live sessions (global index, swept first).
   *
   * @throws {SessionStoreError} When the underlying store fails
   */
  count(): Promise<number>;

  /**
   * Count a user's live sessions (user index, swept first).
   *
   * @param userId - Owning user
   * @throws {SessionStoreError} When the underlying store fails
   */
  countByUser(userId: string): Promise<number>;
}
