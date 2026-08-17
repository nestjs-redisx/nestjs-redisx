/**
 * Shared TTL derivation for the middleware store adapters.
 */

/**
 * Minimal view of a middleware session payload: both `express-session` and
 * `@fastify/session` keep the cookie state under `session.cookie`.
 */
export interface ICookieCarryingSession {
  cookie?: {
    expires?: Date | string | null;
  } | null;
}

/**
 * TTL (ms) for a session write/touch:
 * `cookie.expires - now` when the middleware set an expiry, otherwise the
 * adapter's configured fallback (and `undefined` lets the store default apply).
 *
 * @param session - Raw middleware session payload
 * @param nowMs - Current time
 * @param fallbackTtlMs - Adapter-level fallback TTL
 * @returns TTL in ms; values `<= 0` mean the cookie already expired
 */
export function ttlMsFromSession(session: unknown, nowMs: number, fallbackTtlMs: number | undefined): number | undefined {
  const expires = (session as ICookieCarryingSession | null | undefined)?.cookie?.expires;
  if (expires !== undefined && expires !== null) {
    return new Date(expires).getTime() - nowMs;
  }
  return fallbackTtlMs;
}
