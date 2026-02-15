/**
 * L1 in-memory cache store implementation.
 * Supports LRU and LFU eviction policies.
 */

import { Injectable, Inject } from '@nestjs/common';

import { CACHE_PLUGIN_OPTIONS } from '../../../shared/constants';
import { ICachePluginOptions } from '../../../shared/types';
import { IL1CacheStore } from '../../application/ports/l1-cache-store.port';
import { CacheEntry } from '../../domain/value-objects/cache-entry.vo';

interface ICacheNode<T> {
  key: string;
  entry: CacheEntry<T>;
  prev: ICacheNode<T> | null;
  next: ICacheNode<T> | null;
  expiresAt: number;
  frequency: number;
}

@Injectable()
export class L1MemoryStoreAdapter implements IL1CacheStore {
  private readonly cache = new Map<string, ICacheNode<unknown>>();
  private head: ICacheNode<unknown> | null = null;
  private tail: ICacheNode<unknown> | null = null;
  private readonly maxSize: number;
  private readonly defaultTtl: number;
  private readonly evictionPolicy: 'lru' | 'lfu';
  private hits = 0;
  private misses = 0;

  constructor(
    @Inject(CACHE_PLUGIN_OPTIONS)
    private readonly options: ICachePluginOptions,
  ) {
    this.maxSize = options.l1?.maxSize ?? 1000;
    this.defaultTtl = (options.l1?.ttl ?? 60) * 1000; // Convert to ms
    this.evictionPolicy = options.l1?.evictionPolicy ?? 'lru';
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    const node = this.cache.get(key);
    if (!node) {
      this.misses++;
      return null;
    }

    // Check expiration
    if (Date.now() > node.expiresAt) {
      void this.delete(key);
      this.misses++;
      return null;
    }

    if (this.evictionPolicy === 'lru') {
      // Move to front (most recently used)
      this.moveToFront(node);
    } else {
      // LFU: increment frequency
      node.frequency++;
    }

    this.hits++;
    return node.entry as CacheEntry<T>;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async set<T>(key: string, entry: CacheEntry<T>, ttl?: number): Promise<void> {
    const existingNode = this.cache.get(key);

    if (existingNode) {
      // Update existing node
      existingNode.entry = entry;
      existingNode.expiresAt = Date.now() + (ttl ?? this.defaultTtl);

      if (this.evictionPolicy === 'lru') {
        this.moveToFront(existingNode);
      } else {
        existingNode.frequency++;
      }
    } else {
      // Evict if at capacity
      if (this.cache.size >= this.maxSize) {
        this.evict();
      }

      // Create new node
      const node: ICacheNode<unknown> = {
        key,
        entry,
        prev: null,
        next: this.head,
        expiresAt: Date.now() + (ttl ?? this.defaultTtl),
        frequency: 1,
      };

      if (this.head) {
        this.head.prev = node;
      }
      this.head = node;

      if (!this.tail) {
        this.tail = node;
      }

      this.cache.set(key, node);
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async delete(key: string): Promise<boolean> {
    const node = this.cache.get(key);
    if (!node) {
      return false;
    }

    this.removeNode(node);
    this.cache.delete(key);
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async clear(): Promise<void> {
    this.cache.clear();
    this.head = null;
    this.tail = null;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async has(key: string): Promise<boolean> {
    const node = this.cache.get(key);
    if (!node) {
      return false;
    }

    // Check expiration
    if (Date.now() > node.expiresAt) {
      void this.delete(key);
      return false;
    }

    return true;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async size(): Promise<number> {
    // Clean expired entries first
    const now = Date.now();
    for (const [key, node] of this.cache.entries()) {
      if (now > node.expiresAt) {
        void this.delete(key);
      }
    }

    return this.cache.size;
  }

  private moveToFront(node: ICacheNode<unknown>): void {
    if (node === this.head) {
      return;
    }

    this.removeNode(node);

    node.prev = null;
    node.next = this.head;

    if (this.head) {
      this.head.prev = node;
    }

    this.head = node;

    if (!this.tail) {
      this.tail = node;
    }
  }

  private removeNode(node: ICacheNode<unknown>): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }
  }

  private evict(): void {
    if (this.evictionPolicy === 'lfu') {
      this.evictLFU();
    } else {
      this.evictLRU();
    }
  }

  private evictLRU(): void {
    if (!this.tail) {
      return;
    }

    const key = this.tail.key;
    this.removeNode(this.tail);
    this.cache.delete(key);
  }

  private evictLFU(): void {
    if (this.cache.size === 0) {
      return;
    }

    // Find node with lowest frequency; on tie, use linked list order (tail = oldest)
    let victim: ICacheNode<unknown> | null = null;

    let current = this.tail;
    while (current) {
      if (!victim || current.frequency < victim.frequency) {
        victim = current;
      }
      current = current.prev;
    }

    if (victim) {
      this.removeNode(victim);
      this.cache.delete(victim.key);
    }
  }

  getStats(): { hits: number; misses: number; size: number } {
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
    };
  }
}
