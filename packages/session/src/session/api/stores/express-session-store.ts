import type { SessionData, Store } from 'express-session';

import { SessionMiddlewareMissingError } from '../../../shared/errors';
import { invokeCallback } from './safe-callback';
import { ISessionStore } from '../../application/ports/session-store.port';
import { ttlMsFromSession } from './session-cookie-ttl';

/**
 * Options for {@link toExpressStore}.
 */
export interface IExpressSessionStoreOptions {
  /**
   * Fallback TTL (ms) when the middleware sets no `cookie.expires`
   * (i.e. `cookie.maxAge` is unset). Defaults to the plugin `defaultTtlMs`.
   */
  ttlMs?: number;
}

type ExpressSessionModule = typeof import('express-session');

function normalizeModule(mod: ExpressSessionModule & { default?: ExpressSessionModule }): ExpressSessionModule {
  return mod.default?.Store !== undefined ? mod.default : mod;
}

function isModuleNotFound(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return (code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND') && String((error as Error).message).includes('express-session');
}

/**
 * Loads `express-session` lazily so the package stays an optional peer:
 * fastify-only applications never pay for it.
 *
 * `require` is tried first — it also covers Jest, whose CJS test VM cannot
 * host a dynamic `import()` callback. Pure-ESM runtimes (where `require` is
 * unavailable) fall back to dynamic `import()`.
 */
async function loadExpressSession(): Promise<ExpressSessionModule> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return normalizeModule(require('express-session') as ExpressSessionModule);
  } catch (error) {
    if (isModuleNotFound(error)) {
      throw new SessionMiddlewareMissingError('express-session', error as Error);
    }
    // `require` unavailable — fall through to dynamic import.
  }
  try {
    return normalizeModule((await import('express-session')) as ExpressSessionModule & { default?: ExpressSessionModule });
  } catch (error) {
    throw new SessionMiddlewareMissingError('express-session', error as Error);
  }
}

/**
 * Builds an `express-session`-compatible `Store` over the plugin's session
 * store. Drop-in replacement for `connect-redis` — with the plugin's
 * per-user indexing, seat limits, and absolute lifetime cap on top.
 *
 * @param store - The plugin's session store (`@Inject(SESSION_STORE)`)
 * @param options - Adapter options
 * @returns A store instance for `session({ store })`
 * @throws {SessionMiddlewareMissingError} When `express-session` is not installed
 *
 * @example
 * ```typescript
 * const sessionStore = app.get<ISessionStore>(SESSION_STORE);
 * app.use(
 *   session({
 *     secret: 'keyboard cat',
 *     resave: false,
 *     saveUninitialized: false,
 *     store: await toExpressStore(sessionStore),
 *   }),
 * );
 * ```
 */
export async function toExpressStore(store: ISessionStore, options: IExpressSessionStoreOptions = {}): Promise<Store> {
  const { Store: BaseStore } = await loadExpressSession();

  class RedisXExpressSessionStore extends BaseStore {
    get(sid: string, callback: (err?: unknown, session?: SessionData | null) => void): void {
      store.get(sid).then(
        (session) => invokeCallback(callback, null, (session as SessionData | null) ?? null),
        (error: unknown) => invokeCallback(callback, error),
      );
    }

    set(sid: string, session: SessionData, callback?: (err?: unknown) => void): void {
      const ttlMs = ttlMsFromSession(session, Date.now(), options.ttlMs);
      if (ttlMs !== undefined && ttlMs <= 0) {
        // The cookie already expired — an expired session must not be written back.
        store.destroy(sid).then(
          () => invokeCallback(callback, null),
          (error: unknown) => invokeCallback(callback, error),
        );
        return;
      }
      store.set(sid, session, { ttlMs }).then(
        () => invokeCallback(callback, null),
        (error: unknown) => invokeCallback(callback, error),
      );
    }

    destroy(sid: string, callback?: (err?: unknown) => void): void {
      store.destroy(sid).then(
        () => invokeCallback(callback, null),
        (error: unknown) => invokeCallback(callback, error),
      );
    }

    touch(sid: string, session: SessionData, callback?: (err?: unknown) => void): void {
      const ttlMs = ttlMsFromSession(session, Date.now(), options.ttlMs);
      store.touch(sid, { ttlMs }).then(
        () => invokeCallback(callback, null),
        (error: unknown) => invokeCallback(callback, error),
      );
    }
  }

  return new RedisXExpressSessionStore();
}
