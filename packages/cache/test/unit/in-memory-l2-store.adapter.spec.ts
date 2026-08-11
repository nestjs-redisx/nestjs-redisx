import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { InMemoryL2StoreAdapter } from '../../src/cache/infrastructure/adapters/in-memory-l2-store.adapter';
import { CacheEntry } from '../../src/cache/domain/value-objects/cache-entry.vo';
import type { ICachePluginOptions, SwrEntry } from '../../src/shared/types';

const OPTIONS: ICachePluginOptions = {
  l1: { maxSize: 3, evictionPolicy: 'lru' },
  l2: { keyPrefix: 'cache:', defaultTtl: 3600 },
};

const entry = <T>(value: T): CacheEntry<T> => CacheEntry.create(value, 3600);

describe('InMemoryL2StoreAdapter', () => {
  let store: InMemoryL2StoreAdapter;

  beforeEach(() => {
    store = new InMemoryL2StoreAdapter(OPTIONS);
  });

  it('stores and retrieves the SAME entry instance (live reference, no copy)', async () => {
    // Given
    const e = entry({ a: 1 });

    // When
    await store.set('k', e);

    // Then — no serialization: the exact object comes back (shared with L1)
    expect(await store.get('k')).toBe(e);
  });

  it('returns null on a miss', async () => {
    expect(await store.get('nope')).toBeNull();
  });

  it('delete removes an entry and reports whether it existed', async () => {
    // Given
    await store.set('k', entry(1));

    // When / Then
    expect(await store.delete('k')).toBe(true);
    expect(await store.get('k')).toBeNull();
    expect(await store.delete('k')).toBe(false);
  });

  it('has reflects presence', async () => {
    await store.set('k', entry(1));
    expect(await store.has('k')).toBe(true);
    expect(await store.has('absent')).toBe(false);
  });

  it('clear empties the store', async () => {
    await store.set('k', entry(1));
    await store.clear();
    expect(await store.get('k')).toBeNull();
  });

  it('getMany maps present and absent keys', async () => {
    await store.set('a', entry(1));
    const result = await store.getMany<number>(['a', 'b']);
    expect(result[0]?.value).toBe(1);
    expect(result[1]).toBeNull();
  });

  it('setMany stores all entries', async () => {
    await store.setMany([
      { key: 'a', entry: entry(1) },
      { key: 'b', entry: entry(2) },
    ]);
    expect((await store.get<number>('a'))?.value).toBe(1);
    expect((await store.get<number>('b'))?.value).toBe(2);
  });

  it('ttl returns remaining seconds, or -2 when absent', async () => {
    await store.set('k', entry(1), 100);
    const ttl = await store.ttl('k');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(100);
    expect(await store.ttl('absent')).toBe(-2);
  });

  it('getStats tracks hits and misses', async () => {
    await store.set('k', entry(1));
    await store.get('k'); // hit
    await store.get('x'); // miss
    expect(await store.getStats()).toEqual({ hits: 1, misses: 1 });
  });

  describe('expiry', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('lazily expires entries on read', async () => {
      // Given a 1s entry
      await store.set('k', entry(1), 1);

      // When time passes beyond the TTL
      vi.advanceTimersByTime(1500);

      // Then it reads as a miss
      expect(await store.get('k')).toBeNull();
    });
  });

  describe('SWR / stale-if-error retention', () => {
    it('setSwr stores an entry retained until keepUntil', async () => {
      // Given a SWR entry with a stale-if-error window
      const now = Date.now();
      const swr: SwrEntry<string> = { value: 'v', cachedAt: now, staleAt: now + 1000, expiresAt: now + 2000, keepUntil: now + 5000 };

      // When
      await store.setSwr('k', swr);

      // Then
      expect((await store.getSwr<string>('k'))?.value).toBe('v');
    });

    it('does not store an already-expired SWR entry', async () => {
      const now = Date.now();
      await store.setSwr('k', { value: 'v', cachedAt: now - 10000, staleAt: now - 9000, expiresAt: now - 1000 });
      expect(await store.getSwr('k')).toBeNull();
    });
  });

  describe('scan', () => {
    it('glob-matches with * and strips the prefix', async () => {
      await store.set('user:1', entry(1));
      await store.set('user:2', entry(2));
      await store.set('post:1', entry(3));

      const result = await store.scan('user:*');

      expect(result.keys.sort()).toEqual(['user:1', 'user:2']);
      expect(result.cursor).toBe('0');
    });

    it('supports the ? single-char wildcard', async () => {
      await store.set('a1', entry(1));
      await store.set('a2', entry(2));
      await store.set('abc', entry(3));

      const result = await store.scan('a?');

      expect(result.keys.sort()).toEqual(['a1', 'a2']);
    });

    it('supports [set] character classes', async () => {
      await store.set('item1', entry(1));
      await store.set('item2', entry(2));
      await store.set('item9', entry(3));

      const result = await store.scan('item[12]');

      expect(result.keys.sort()).toEqual(['item1', 'item2']);
    });
  });

  describe('eviction (maxSize=3, lru)', () => {
    it('evicts the least-recently-used entry when over capacity', async () => {
      // Given the store at capacity
      await store.set('a', entry(1));
      await store.set('b', entry(2));
      await store.set('c', entry(3));

      // When 'a' is touched (now MRU, 'b' is LRU) and a 4th key is added
      await store.get('a');
      await store.set('d', entry(4));

      // Then 'b' was evicted; 'a' and 'd' remain
      expect(await store.get('b')).toBeNull();
      expect((await store.get<number>('a'))?.value).toBe(1);
      expect((await store.get<number>('d'))?.value).toBe(4);
    });
  });

  describe('eviction (lfu)', () => {
    it('evicts the least-frequently-used entry when over capacity', async () => {
      // Given an LFU store at capacity 2
      const lfu = new InMemoryL2StoreAdapter({ l1: { maxSize: 2, evictionPolicy: 'lfu' }, l2: { keyPrefix: 'cache:' } });
      await lfu.set('a', entry(1));
      await lfu.set('b', entry(2));

      // When 'a' is read repeatedly (high frequency) and a 3rd key is added
      await lfu.get('a');
      await lfu.get('a');
      await lfu.set('c', entry(3));

      // Then the least-frequently-used 'b' was evicted
      expect(await lfu.get('b')).toBeNull();
      expect((await lfu.get<number>('a'))?.value).toBe(1);
      expect((await lfu.get<number>('c'))?.value).toBe(3);
    });
  });
});
