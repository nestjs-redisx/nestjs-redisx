import { ISessionStore } from '../../application/ports/session-store.port';
import { invokeCallback } from './safe-callback';
import { ttlMsFromSession } from './session-cookie-ttl';

/**
 * Options for {@link toFastifyStore}.
 */
export interface IFastifySessionStoreOptions {
  /**
   * Fallback TTL (ms) when the middleware sets no `cookie.expires`.
   * Defaults to the plugin `defaultTtlMs`.
   */
  ttlMs?: number;
}

/**
 * Minimal structural shape of a `@fastify/session` session object.
 * Matches `Fastify.Session` (whose only required field is
 * `cookie.originalMaxAge`) so the store below is assignable to the
 * `SessionStore` type without depending on the `@fastify/session` package.
 */
export interface IFastifySessionPayload {
  cookie: { originalMaxAge: number | null };
}

/**
 * The callback store contract expected by `@fastify/session`.
 * Structural — no dependency on the `@fastify/session` package is needed.
 */
export interface IFastifySessionStore {
  get(sessionId: string, callback: (err: unknown, session?: IFastifySessionPayload | null) => void): void;
  set(sessionId: string, session: IFastifySessionPayload, callback: (err?: unknown) => void): void;
  destroy(sessionId: string, callback: (err?: unknown) => void): void;
}

/**
 * Builds a `@fastify/session`-compatible store over the plugin's session
 * store. Dependency-free: `@fastify/session` only consumes the returned
 * object, so express-only applications never load fastify code (and vice
 * versa).
 *
 * @param store - The plugin's session store (`@Inject(SESSION_STORE)`)
 * @param options - Adapter options
 * @returns A store object for `fastifySession({ store })`
 *
 * @example
 * ```typescript
 * const sessionStore = app.get<ISessionStore>(SESSION_STORE);
 * await app.register(fastifySession, {
 *   secret: 'a secret with minimum length of 32 characters',
 *   store: toFastifyStore(sessionStore),
 * });
 * ```
 */
export function toFastifyStore(store: ISessionStore, options: IFastifySessionStoreOptions = {}): IFastifySessionStore {
  return {
    get(sessionId, callback): void {
      store.get(sessionId).then(
        (session) => invokeCallback(callback, null, (session as IFastifySessionPayload | null) ?? null),
        (error: unknown) => invokeCallback(callback, error),
      );
    },

    set(sessionId, session, callback): void {
      const ttlMs = ttlMsFromSession(session, Date.now(), options.ttlMs);
      if (ttlMs !== undefined && ttlMs <= 0) {
        // The cookie already expired — an expired session must not be written back.
        store.destroy(sessionId).then(
          () => invokeCallback(callback, null),
          (error: unknown) => invokeCallback(callback, error),
        );
        return;
      }
      store.set(sessionId, session, { ttlMs }).then(
        () => invokeCallback(callback, null),
        (error: unknown) => invokeCallback(callback, error),
      );
    },

    destroy(sessionId, callback): void {
      store.destroy(sessionId).then(
        () => invokeCallback(callback, null),
        (error: unknown) => invokeCallback(callback, error),
      );
    },
  };
}
