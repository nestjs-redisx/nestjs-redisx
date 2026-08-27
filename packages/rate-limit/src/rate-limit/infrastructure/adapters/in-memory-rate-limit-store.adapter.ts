import { Injectable, Inject, Optional, OnModuleDestroy } from '@nestjs/common';

import { RATE_LIMIT_PLUGIN_OPTIONS } from '../../../shared/constants';
import { IRateLimitPluginOptions, IRateLimitResult } from '../../../shared/types';
import { IRateLimitStore } from '../../application/ports/rate-limit-store.port';
import { applyFixedWindow, applySlidingWindow, applyTokenBucket, peekFixedWindow, peekSlidingWindow, peekTokenBucket, isEntryExpired, IMemoryRateLimitEntry } from '../../domain/memory/in-memory-algorithms';

const DEFAULT_MAX_KEYS = 100_000;
const DEFAULT_SWEEP_INTERVAL_MS = 30_000;

/**
 * In-memory (per-instance) rate limit store.
 *
 * Counters live in process memory: no Redis round-trip on the request path,
 * at the cost of per-node (approximate) limits. Node's single-threaded event
 * loop makes each check atomic without locking.
 *
 * Memory safety: Redis bounds its keyspace via EXPIRE; here a key cap with
 * oldest-first eviction plus a periodic sweep of expired entries prevents
 * unbounded growth under key spray (e.g. random IPs). The sweep timer starts
 * lazily on first use and never keeps the process alive (unref).
 */
@Injectable()
export class InMemoryRateLimitStoreAdapter implements IRateLimitStore, OnModuleDestroy {
  private readonly entries = new Map<string, IMemoryRateLimitEntry>();
  private readonly maxKeys: number;
  private readonly sweepIntervalMs: number;
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(@Optional() @Inject(RATE_LIMIT_PLUGIN_OPTIONS) options: IRateLimitPluginOptions = {}) {
    this.maxKeys = options.memory?.maxKeys ?? DEFAULT_MAX_KEYS;
    this.sweepIntervalMs = options.memory?.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  }

  /** Number of tracked keys (monitoring/testing aid). */
  get size(): number {
    return this.entries.size;
  }

  async fixedWindow(key: string, points: number, duration: number): Promise<IRateLimitResult> {
    const { entry, result } = applyFixedWindow(this.entries.get(key), Date.now(), points, duration);
    this.write(key, entry);
    return result;
  }

  async slidingWindow(key: string, points: number, duration: number): Promise<IRateLimitResult> {
    const { entry, result } = applySlidingWindow(this.entries.get(key), Date.now(), points, duration);
    this.write(key, entry);
    return result;
  }

  async tokenBucket(key: string, capacity: number, refillRate: number, consume = 1): Promise<IRateLimitResult> {
    const { entry, result } = applyTokenBucket(this.entries.get(key), Date.now(), capacity, refillRate, consume);
    this.write(key, entry);
    return result;
  }

  async peek(key: string, algorithm: string, config: Record<string, number>): Promise<IRateLimitResult> {
    const now = Date.now();
    const entry = this.entries.get(key);

    if (algorithm === 'fixed-window') {
      return peekFixedWindow(entry, now, config.points || 100, config.duration || 60);
    }
    if (algorithm === 'sliding-window') {
      return peekSlidingWindow(entry, now, config.points || 100, config.duration || 60);
    }
    return peekTokenBucket(entry, now, config.capacity || 100, config.refillRate || 10);
  }

  async reset(key: string): Promise<void> {
    this.entries.delete(key);
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  private write(key: string, entry: IMemoryRateLimitEntry): void {
    if (!this.entries.has(key) && this.entries.size >= this.maxKeys) {
      this.evictOldest();
    }
    this.entries.set(key, entry);
    this.ensureSweepTimer();
  }

  /**
   * Approximate FIFO eviction: Map preserves insertion order, so the first
   * key is the oldest-inserted one. Limiter entries are short-lived, which
   * makes insertion age a good enough proxy for staleness.
   */
  private evictOldest(): void {
    while (this.entries.size >= this.maxKeys) {
      const oldest = this.entries.keys().next();
      if (oldest.done) {
        return;
      }
      this.entries.delete(oldest.value);
    }
  }

  private ensureSweepTimer(): void {
    if (this.sweepTimer) {
      return;
    }
    this.sweepTimer = setInterval(() => this.sweep(), this.sweepIntervalMs);
    this.sweepTimer.unref?.();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (isEntryExpired(entry, now)) {
        this.entries.delete(key);
      }
    }
  }
}
