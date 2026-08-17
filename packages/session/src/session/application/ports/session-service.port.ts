import { ISessionActivity, ISessionInfo } from '../../../shared/types';

/**
 * Session service port: the Redis-native capabilities the middleware Store
 * contract cannot offer — introspection ("device page"), revocation
 * ("log out everywhere"), and counting.
 *
 * @template T - Application session payload shape (compile-time contract only;
 *   session contents are not validated at runtime)
 */
export interface ISessionService<T = unknown> {
  /**
   * Read a single session with its metadata (support/debug).
   *
   * @param sessionId - Middleware session ID
   * @returns Session info, or `null` when absent/expired
   * @throws {SessionStoreError} When the underlying store fails
   *
   * @example
   * ```typescript
   * const info = await sessions.getSession(req.sessionID);
   * console.log(info?.metadata?.lastSeenAt);
   * ```
   */
  getSession(sessionId: string): Promise<ISessionInfo<T> | null>;

  /**
   * List a user's live sessions with metadata — the GitHub-style
   * "Chrome on Mac, last active 2h ago" device page.
   *
   * @param userId - Owning user
   * @throws {SessionStoreError} When the underlying store fails
   *
   * @example
   * ```typescript
   * const devices = await sessions.getSessionsByUser(user.id);
   * return devices.map((s) => ({ id: s.id, ua: s.metadata?.userAgent }));
   * ```
   */
  getSessionsByUser(userId: string): Promise<Array<ISessionInfo<T>>>;

  /**
   * Count all live sessions.
   *
   * @throws {SessionStoreError} When the underlying store fails
   */
  count(): Promise<number>;

  /**
   * Count a user's live sessions.
   *
   * @param userId - Owning user
   * @throws {SessionStoreError} When the underlying store fails
   */
  countByUser(userId: string): Promise<number>;

  /**
   * Revoke a single session. The owner's next request is treated as
   * unauthenticated.
   *
   * @param sessionId - Middleware session ID
   * @returns `true` when a session existed
   * @throws {SessionStoreError} When the underlying store fails
   */
  revoke(sessionId: string): Promise<boolean>;

  /**
   * Revoke every session of a user (password change / compromise response).
   *
   * @param userId - Owning user
   * @returns Number of sessions revoked
   * @throws {SessionStoreError} When the underlying store fails
   */
  revokeAll(userId: string): Promise<number>;

  /**
   * Revoke every session of a user except the current one — the
   * "log out everywhere else" button (plain revokeAll would log out the
   * clicker too).
   *
   * @param userId - Owning user
   * @param currentSessionId - Session to keep alive
   * @returns Number of sessions revoked
   * @throws {SessionStoreError} When the underlying store fails
   *
   * @example
   * ```typescript
   * await sessions.revokeAllExcept(user.id, req.sessionID);
   * ```
   */
  revokeAllExcept(userId: string, currentSessionId: string): Promise<number>;

  /**
   * Stamp request-scoped activity attributes (IP, user agent) onto a
   * session's metadata. Wire it as a tiny middleware after the session
   * middleware; without it the device page has no IP/user-agent columns.
   *
   * @param sessionId - Middleware session ID
   * @param activity - Attributes to stamp
   * @throws {SessionStoreError} When the underlying store fails
   */
  recordActivity(sessionId: string, activity: ISessionActivity): Promise<void>;
}
