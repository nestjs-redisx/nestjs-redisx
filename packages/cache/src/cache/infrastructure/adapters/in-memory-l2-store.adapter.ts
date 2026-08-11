/**
 * In-memory L2 cache store for `mode: 'l1-only'`.
 *
 * A drop-in {@link IL2CacheStore} that keeps values in a local `Map` instead of
 * Redis, so the cache runs with NO Redis connection. Unlike the memory driver
 * (which serializes into a second byte copy), this store keeps the LIVE
 * `CacheEntry` / `SwrEntry` object — the very same instance L1 holds — so a
 * value is stored ONCE and merely referenced by both tiers (no duplication,
 * which matters for large values).
 *
 * It mirrors {@link L2RedisStoreAdapter} exactly on the wire: internal keys
 * carry the `l2.keyPrefix`, `scan()` returns prefix-stripped keys, and
 * `setSwr()` retains an entry until `keepUntil` (stale-if-error) or its SWR
 * expiry. Sizing/eviction come from the `l1` block (the natural knob for an
 * in-memory cache); TTLs come from `l2`. Entries expire lazily on access, and
 * the store is bounded by `l1.maxSize` with LRU/LFU eviction.
 *
 * Single-instance only: nothing here is shared across processes.
 */

import { Injectable, Inject } from '@nestjs/common';

import { CACHE_PLUGIN_OPTIONS } from '../../../shared/constants';
import { ICachePluginOptions, ScanResult, SwrEntry } from '../../../shared/types';
import { IL2CacheStore } from '../../application/ports/l2-cache-store.port';
import { CacheEntry } from '../../domain/value-objects/cache-entry.vo';

/** Default batch size hint for SCAN. */
const DEFAULT_BATCH_SIZE = 100;

interface IMemoryNode {
  /** Live entry — a `CacheEntry` (plain) or `SwrEntry` (SWR / stale-if-error). */
  value: CacheEntry<unknown> | SwrEntry<unknown>;
  /** Absolute expiry in ms (for SWR: `keepUntil ?? expiresAt`). */
  expiresAt: number;
  /** Access count, for LFU eviction. */
  frequency: number;
}

@Injectable()
export class InMemoryL2StoreAdapter implements IL2CacheStore {
  private readonly store = new Map<string, IMemoryNode>();
  private readonly keyPrefix: string;
  private readonly defaultTtl: number;
  private readonly maxSize: number;
  private readonly evictionPolicy: 'lru' | 'lfu';
  private hits = 0;
  private misses = 0;

  constructor(
    @Inject(CACHE_PLUGIN_OPTIONS)
    private readonly options: ICachePluginOptions,
  ) {
    this.keyPrefix = options.l2?.keyPrefix ?? 'cache:';
    this.defaultTtl = options.l2?.defaultTtl ?? 3600;
    // In l1-only the `l1` block sizes the single in-memory cache.
    this.maxSize = options.l1?.maxSize ?? 1000;
    this.evictionPolicy = options.l1?.evictionPolicy ?? 'lru';
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    const node = this.readNode(key);
    if (!node) {
      this.misses++;
      return null;
    }
    this.hits++;
    return node.value as CacheEntry<T>;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async set<T>(key: string, entry: CacheEntry<T>, ttl?: number): Promise<void> {
    const ttlSeconds = ttl ?? this.defaultTtl;
    this.writeNode(this.buildKey(key), entry, Date.now() + ttlSeconds * 1000);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async delete(key: string): Promise<boolean> {
    return this.store.delete(this.buildKey(key));
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async has(key: string): Promise<boolean> {
    return this.readNode(key) !== null;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async clear(): Promise<void> {
    this.store.clear();
  }

  async getMany<T>(keys: string[]): Promise<Array<CacheEntry<T> | null>> {
    return Promise.all(keys.map((key) => this.get<T>(key)));
  }

  async setMany<T>(entries: Array<{ key: string; entry: CacheEntry<T>; ttl?: number }>): Promise<void> {
    await Promise.all(entries.map(({ key, entry, ttl }) => this.set(key, entry, ttl)));
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async ttl(key: string): Promise<number> {
    const node = this.store.get(this.buildKey(key));
    if (!node) {
      return -2;
    }
    if (Date.now() > node.expiresAt) {
      this.store.delete(this.buildKey(key));
      return -2;
    }
    return Math.max(1, Math.ceil((node.expiresAt - Date.now()) / 1000));
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getStats(): Promise<{ hits: number; misses: number }> {
    return { hits: this.hits, misses: this.misses };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getSwr<T>(key: string): Promise<SwrEntry<T> | null> {
    const node = this.readNode(key);
    if (!node) {
      this.misses++;
      return null;
    }
    this.hits++;
    return node.value as SwrEntry<T>;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async setSwr<T>(key: string, swrEntry: SwrEntry<T>): Promise<void> {
    // Physical retention matches the Redis adapter: keepUntil (stale-if-error)
    // when present, otherwise the SWR expiry. Already-expired entries are not
    // stored.
    const retainUntil = swrEntry.keepUntil ?? swrEntry.expiresAt;
    if (retainUntil - Date.now() <= 0) {
      return;
    }
    this.writeNode(this.buildKey(key), swrEntry, retainUntil);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async scan(pattern: string, _count: number = DEFAULT_BATCH_SIZE): Promise<ScanResult> {
    const matcher = this.globToRegExp(`${this.keyPrefix}${pattern}`);
    const keys: string[] = [];
    const now = Date.now();
    for (const [fullKey, node] of this.store.entries()) {
      if (now > node.expiresAt) {
        this.store.delete(fullKey);
        continue;
      }
      if (matcher.test(fullKey)) {
        keys.push(fullKey.startsWith(this.keyPrefix) ? fullKey.slice(this.keyPrefix.length) : fullKey);
      }
    }
    // Full scan completed in one pass — cursor is always '0'.
    return { keys, cursor: '0' };
  }

  private buildKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  /** Reads a node by un-prefixed key, honoring lazy expiry and touching it for eviction. */
  private readNode(key: string): IMemoryNode | null {
    const fullKey = this.buildKey(key);
    const node = this.store.get(fullKey);
    if (!node) {
      return null;
    }
    if (Date.now() > node.expiresAt) {
      this.store.delete(fullKey);
      return null;
    }
    this.touch(fullKey, node);
    return node;
  }

  private writeNode(fullKey: string, value: IMemoryNode['value'], expiresAt: number): void {
    const existing = this.store.get(fullKey);
    if (existing) {
      existing.value = value;
      existing.expiresAt = expiresAt;
      this.touch(fullKey, existing);
      return;
    }
    if (this.store.size >= this.maxSize) {
      this.evict();
    }
    this.store.set(fullKey, { value, expiresAt, frequency: 1 });
  }

  /** Marks a node as most-recently/frequently used. */
  private touch(fullKey: string, node: IMemoryNode): void {
    if (this.evictionPolicy === 'lfu') {
      node.frequency++;
      return;
    }
    // LRU: re-insert to move to the end (most-recently-used) of the Map order.
    this.store.delete(fullKey);
    this.store.set(fullKey, node);
  }

  private evict(): void {
    if (this.store.size === 0) {
      return;
    }
    if (this.evictionPolicy === 'lfu') {
      let victimKey: string | null = null;
      let victimFreq = Infinity;
      for (const [k, node] of this.store.entries()) {
        if (node.frequency < victimFreq) {
          victimFreq = node.frequency;
          victimKey = k;
        }
      }
      if (victimKey !== null) {
        this.store.delete(victimKey);
      }
      return;
    }
    // LRU: the first key in Map iteration order is the least-recently-used.
    const oldest = this.store.keys().next().value;
    if (oldest !== undefined) {
      this.store.delete(oldest);
    }
  }

  /** Converts a Redis-style glob (`*`, `?`, `[set]`) to an anchored RegExp. */
  private globToRegExp(pattern: string): RegExp {
    let regex = '';
    for (let i = 0; i < pattern.length; i++) {
      const ch = pattern[i]!;
      if (ch === '*') {
        regex += '.*';
      } else if (ch === '?') {
        regex += '.';
      } else if (ch === '[') {
        // Pass character classes through to the RegExp engine.
        let cls = '[';
        i++;
        while (i < pattern.length && pattern[i] !== ']') {
          const c = pattern[i]!;
          cls += c === '\\' ? '\\\\' : c;
          i++;
        }
        cls += ']';
        regex += cls;
      } else {
        regex += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }
    }
    return new RegExp(`^${regex}$`);
  }
}
