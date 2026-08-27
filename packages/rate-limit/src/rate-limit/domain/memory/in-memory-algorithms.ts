import { IRateLimitResult } from '../../../shared/types';

/**
 * Pure, time-injected implementations of the three rate limit algorithms for
 * the in-memory store. Result parity contract: for the same inputs these
 * functions produce exactly what the Lua scripts + the Redis adapter's
 * parse helpers produce — including rounding and the `retryAfter`
 * 0 -> undefined mapping. `now` is always epoch milliseconds.
 */

export interface IFixedWindowEntry {
  kind: 'fixed';
  /** Window start, epoch seconds. */
  window: number;
  count: number;
  /** Epoch ms after which the entry is dead (sweep/lazy-expiry boundary). */
  expiresAt: number;
}

export interface ISlidingWindowEntry {
  kind: 'sliding';
  /** Epoch ms of each allowed request, oldest first. */
  timestamps: number[];
  expiresAt: number;
}

export interface ITokenBucketEntry {
  kind: 'bucket';
  tokens: number;
  /** Epoch ms of the last refill computation. */
  lastRefill: number;
  expiresAt: number;
}

export type IMemoryRateLimitEntry = IFixedWindowEntry | ISlidingWindowEntry | ITokenBucketEntry;

/**
 * True when the entry has outlived its retention window and must be treated
 * as absent (the in-memory equivalent of Redis key expiry).
 */
export function isEntryExpired(entry: IMemoryRateLimitEntry, now: number): boolean {
  return now >= entry.expiresAt;
}

function liveEntry<K extends IMemoryRateLimitEntry['kind']>(entry: IMemoryRateLimitEntry | undefined, kind: K, now: number): Extract<IMemoryRateLimitEntry, { kind: K }> | undefined {
  if (entry?.kind !== kind || isEntryExpired(entry, now)) {
    return undefined;
  }
  return entry as Extract<IMemoryRateLimitEntry, { kind: K }>;
}

/**
 * Fixed window: counter per aligned window. Lua parity: the counter keeps
 * incrementing on rejects (INCR runs unconditionally).
 */
export function applyFixedWindow(entry: IMemoryRateLimitEntry | undefined, now: number, points: number, duration: number): { entry: IFixedWindowEntry; result: IRateLimitResult } {
  const nowSeconds = Math.floor(now / 1000);
  const window = Math.floor(nowSeconds / duration) * duration;

  const live = liveEntry(entry, 'fixed', now);
  const count = (live?.window === window ? live.count : 0) + 1;

  const allowed = count <= points;
  const reset = window + duration;
  const next: IFixedWindowEntry = { kind: 'fixed', window, count, expiresAt: reset * 1000 };

  return {
    entry: next,
    result: {
      allowed,
      limit: points,
      remaining: Math.max(0, points - count),
      reset,
      current: count,
      retryAfter: allowed ? undefined : Math.ceil(reset - now / 1000),
    },
  };
}

/**
 * Sliding window log. Lua parity: entries with score <= now - duration are
 * pruned (inclusive boundary), rejected requests are NOT recorded, and the
 * expiry is refreshed only on allow (PEXPIRE lives in the allow branch).
 */
export function applySlidingWindow(entry: IMemoryRateLimitEntry | undefined, now: number, points: number, duration: number): { entry: ISlidingWindowEntry; result: IRateLimitResult } {
  const durationMs = duration * 1000;
  const windowStart = now - durationMs;

  const live = liveEntry(entry, 'sliding', now);
  const timestamps = live ? live.timestamps.filter((ts) => ts > windowStart) : [];
  const current = timestamps.length;
  const reset = Math.ceil((now + durationMs) / 1000);

  if (current < points) {
    timestamps.push(now);
    return {
      entry: { kind: 'sliding', timestamps, expiresAt: now + durationMs },
      result: {
        allowed: true,
        limit: points,
        remaining: points - current - 1,
        reset,
        current: current + 1,
        retryAfter: undefined,
      },
    };
  }

  const oldest = timestamps[0];
  const retryAfter = oldest !== undefined ? Math.max(0, Math.ceil((oldest + durationMs - now) / 1000)) : 0;
  return {
    entry: { kind: 'sliding', timestamps, expiresAt: live ? live.expiresAt : now + durationMs },
    result: {
      allowed: false,
      limit: points,
      remaining: 0,
      reset,
      current,
      // Lua parity: parse maps a zero retry_after to undefined
      retryAfter: retryAfter > 0 ? retryAfter : undefined,
    },
  };
}

/**
 * Token bucket. Lua parity: state is persisted on BOTH branches (reject still
 * stores the refilled tokens and stamps lastRefill), `current` is the floored
 * pre-consume token count, and retention mirrors
 * PEXPIRE ceil(capacity / refillRate * 1000) + 1000.
 */
export function applyTokenBucket(entry: IMemoryRateLimitEntry | undefined, now: number, capacity: number, refillRate: number, consume = 1): { entry: ITokenBucketEntry; result: IRateLimitResult } {
  const live = liveEntry(entry, 'bucket', now);
  const storedTokens = live ? live.tokens : capacity;
  const lastRefill = live ? live.lastRefill : now;

  const elapsedSeconds = (now - lastRefill) / 1000;
  const tokens = Math.min(capacity, storedTokens + elapsedSeconds * refillRate);

  const allowed = tokens >= consume;
  const newTokens = allowed ? tokens - consume : tokens;

  const retryAfter = allowed ? 0 : Math.ceil((consume - newTokens) / refillRate);
  const timeToFull = refillRate > 0 ? (capacity - newTokens) / refillRate : 0;

  return {
    entry: {
      kind: 'bucket',
      tokens: newTokens,
      lastRefill: now,
      expiresAt: now + Math.ceil((capacity / refillRate) * 1000) + 1000,
    },
    result: {
      allowed,
      limit: capacity,
      remaining: Math.floor(newTokens),
      reset: Math.ceil(now / 1000 + timeToFull),
      current: Math.floor(tokens),
      retryAfter: retryAfter > 0 ? retryAfter : undefined,
    },
  };
}

/**
 * Peek parity with RedisRateLimitStoreAdapter.peek: fixed window uses strict
 * `<` for allowed, sliding window resets at floor(now/1000) + duration, and
 * token bucket reports `current` as capacity - remaining.
 */
export function peekFixedWindow(entry: IMemoryRateLimitEntry | undefined, now: number, points: number, duration: number): IRateLimitResult {
  const nowSeconds = Math.floor(now / 1000);
  const window = Math.floor(nowSeconds / duration) * duration;

  const live = liveEntry(entry, 'fixed', now);
  const current = live?.window === window ? live.count : 0;

  return {
    allowed: current < points,
    limit: points,
    remaining: Math.max(0, points - current),
    reset: window + duration,
    current,
  };
}

export function peekSlidingWindow(entry: IMemoryRateLimitEntry | undefined, now: number, points: number, duration: number): IRateLimitResult {
  const live = liveEntry(entry, 'sliding', now);
  const windowStart = now - duration * 1000;
  const current = live ? live.timestamps.filter((ts) => ts > windowStart).length : 0;

  return {
    allowed: current < points,
    limit: points,
    remaining: Math.max(0, points - current),
    reset: Math.floor(now / 1000) + duration,
    current,
  };
}

export function peekTokenBucket(entry: IMemoryRateLimitEntry | undefined, now: number, capacity: number, refillRate: number): IRateLimitResult {
  const live = liveEntry(entry, 'bucket', now);
  const storedTokens = live ? live.tokens : capacity;
  const lastRefill = live ? live.lastRefill : now;

  const elapsedSeconds = Math.max(0, (now - lastRefill) / 1000);
  const tokens = Math.min(capacity, storedTokens + elapsedSeconds * refillRate);
  const remaining = Math.floor(tokens);
  const timeToFull = refillRate > 0 ? (capacity - tokens) / refillRate : 0;

  return {
    allowed: tokens >= 1,
    limit: capacity,
    remaining,
    reset: Math.ceil(now / 1000 + timeToFull),
    current: capacity - remaining,
  };
}
