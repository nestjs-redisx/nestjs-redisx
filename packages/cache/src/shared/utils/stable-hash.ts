/**
 * Stable object hashing for cache keys.
 *
 * This is the SAME algorithm the `@Cached` decorator uses to auto-generate
 * keys from object arguments — exposed for the manual path
 * (`cache.getOrSet` / `get` / `delete`), so nobody has to hand-roll a
 * "sort keys then hash" helper (and get the edge cases wrong: BigInt throws
 * in JSON.stringify, Map/Set collapse to `{}`, nested keys stay unsorted).
 *
 * FROZEN ALGORITHM: the output of `hashKey` is part of the public contract.
 * Changing it would silently shift every derived cache key on upgrade
 * (cold cache + stampede across deployments, cross-service key mismatches).
 * Any future change must ship under a NEW name, never as an in-place edit.
 * Exception carved out once: Map/Set handling was ADDED after the initial
 * release - before that, every Map and every Set serialized to `{}`, so all
 * of them collided on a single key (distinct inputs could serve each other's
 * cached values). Fixing a collision is a bug fix, not an algorithm change:
 * keys for all other input types are byte-identical (golden-vector proven).
 */

import { createHash } from 'crypto';

/**
 * Produces a deterministic JSON string by sorting object keys recursively.
 * Ensures {b:2, a:1} and {a:1, b:2} serialize identically at every nesting
 * level, while array order (significant) is preserved. Maps serialize as
 * sorted, type-prefixed entries; Sets as sorted, type-prefixed items.
 */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }

  // Functions and symbols are not serializable (matches JSON.stringify behavior)
  if (typeof value === 'function' || typeof value === 'symbol') {
    return 'null';
  }

  if (typeof value !== 'object') {
    // BigInt throws in JSON.stringify; convert to string for safe key generation
    if (typeof value === 'bigint') {
      return String(value);
    }
    return JSON.stringify(value);
  }

  // Arrays: preserve order, serialize undefined/functions as null (matches JSON.stringify)
  if (Array.isArray(value)) {
    return '[' + value.map((item) => (item === undefined || typeof item === 'function' || typeof item === 'symbol' ? 'null' : stableStringify(item))).join(',') + ']';
  }

  if (value instanceof Date) {
    return JSON.stringify(value);
  }

  // Map: serialize entries with canonicalized keys AND values, sorted by the
  // serialized (key, value) pair - deterministic regardless of insertion
  // order. Sorting by key alone is not enough: distinct object keys can share
  // the same canonical serialization (e.g. two {a:1} references), leaving the
  // comparator to return 0 and the tie broken by insertion order. The 'Map{'
  // prefix keeps new Map([['a',1]]) distinct from the plain object {a:1}.
  // (Previously Maps fell through to the plain-object branch and ALL of them
  // serialized to '{}' - every Map collided on one cache key.)
  if (value instanceof Map) {
    const entries = [...value.entries()].map(([k, v]) => [stableStringify(k), stableStringify(v)] as const);
    entries.sort(([keyA, valueA], [keyB, valueB]) => {
      if (keyA !== keyB) return keyA < keyB ? -1 : 1;
      return valueA < valueB ? -1 : valueA > valueB ? 1 : 0;
    });
    return 'Map{' + entries.map(([k, v]) => k + ':' + v).join(',') + '}';
  }

  // Set: semantically unordered - serialize the items, then sort, so
  // new Set([1,2]) and new Set([2,1]) produce the same key. The 'Set['
  // prefix keeps sets distinct from arrays (whose order is significant).
  if (value instanceof Set) {
    const items = [...value].map((item) => stableStringify(item)).sort();
    return 'Set[' + items.join(',') + ']';
  }

  // Plain objects: sort keys, skip undefined/function/symbol values (matches JSON.stringify)
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const v = obj[key];
    if (v === undefined || typeof v === 'function' || typeof v === 'symbol') {
      continue; // JSON.stringify skips these in objects
    }
    parts.push(JSON.stringify(key) + ':' + stableStringify(v));
  }
  return '{' + parts.join(',') + '}';
}

/**
 * Hashes any JSON-serializable value into a short, deterministic,
 * CacheKey-safe string: SHA-256 over the stable serialization, truncated to
 * 16 hex chars (64 bits). Key-order-insensitive at every nesting level.
 *
 * Intended for CACHE KEYS only — the 64-bit truncation is not suitable for
 * identity, deduplication ledgers, or anything security-sensitive.
 *
 * @example
 * ```typescript
 * const key = `calc:${hashKey(body)}`;
 * const result = await cache.getOrSet(key, () => this.compute(body));
 * // {a:1,b:2} and {b:2,a:1} produce the same key
 * ```
 */
export function hashKey(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex').slice(0, 16);
}
