/**
 * Pure session-metadata logic: hash parsing, absolute-lifetime math, and the
 * default (Passport-convention) user ID extractor.
 *
 * Time is always injected (`nowMs`); this module never reads the clock.
 * The TTL math here mirrors the arithmetic inside the Lua scripts — keep both
 * in sync.
 */

import { ISessionMetadata } from '../../shared/types';

/**
 * Parses the metadata hash stored next to a session payload.
 *
 * @param hash - Raw Redis hash (`HGETALL` result)
 * @returns Parsed metadata, or `null` when the hash is absent or corrupt
 */
export function parseSessionMetadata(hash: Record<string, string>): ISessionMetadata | null {
  if (Object.keys(hash).length === 0) {
    return null;
  }

  const createdAt = Number(hash['createdAt']);
  const lastSeenAt = Number(hash['lastSeenAt']);
  const expiresAt = Number(hash['expiresAt']);

  if (!Number.isFinite(createdAt) || !Number.isFinite(lastSeenAt) || !Number.isFinite(expiresAt)) {
    return null;
  }

  return {
    userId: hash['userId'] || undefined,
    ip: hash['ip'] || undefined,
    userAgent: hash['userAgent'] || undefined,
    createdAt,
    lastSeenAt,
    expiresAt,
  };
}

/**
 * Whether a session has outlived the absolute lifetime cap.
 *
 * @param createdAtMs - When the session was first written
 * @param nowMs - Current time
 * @param capMs - Absolute lifetime cap; `undefined` disables the check
 */
export function isExpiredByCap(createdAtMs: number, nowMs: number, capMs: number | undefined): boolean {
  return capMs !== undefined && capMs > 0 && nowMs - createdAtMs >= capMs;
}

/**
 * TTL to actually apply: the requested TTL clamped to the remaining absolute
 * lifetime window. Returns 0 when the cap is already exhausted.
 *
 * @param ttlMs - Requested TTL
 * @param createdAtMs - When the session was first written
 * @param nowMs - Current time
 * @param capMs - Absolute lifetime cap; `undefined` disables clamping
 */
export function effectiveTtlMs(ttlMs: number, createdAtMs: number, nowMs: number, capMs: number | undefined): number {
  if (capMs === undefined || capMs <= 0) {
    return ttlMs;
  }
  const remaining = capMs - (nowMs - createdAtMs);
  if (remaining <= 0) {
    return 0;
  }
  return Math.min(ttlMs, remaining);
}

/**
 * Default user ID extractor: reads the Passport convention
 * (`session.passport.user`). Numbers are stringified; anything else that is
 * not a non-empty string yields `undefined`.
 *
 * @param session - Raw middleware session payload
 */
export function defaultUserIdExtractor(session: unknown): string | undefined {
  if (typeof session !== 'object' || session === null) {
    return undefined;
  }
  const passport = (session as Record<string, unknown>)['passport'];
  if (typeof passport !== 'object' || passport === null) {
    return undefined;
  }
  const user = (passport as Record<string, unknown>)['user'];
  if (typeof user === 'string' && user.length > 0) {
    return user;
  }
  if (typeof user === 'number' && Number.isFinite(user)) {
    return String(user);
  }
  return undefined;
}
