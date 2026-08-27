import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InMemoryRateLimitStoreAdapter } from '../../src/rate-limit/infrastructure/adapters/in-memory-rate-limit-store.adapter';

describe('InMemoryRateLimitStoreAdapter', () => {
  let adapter: InMemoryRateLimitStoreAdapter;

  beforeEach(() => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    adapter = new InMemoryRateLimitStoreAdapter({ memory: { maxKeys: 1000, sweepIntervalMs: 30_000 } });
  });

  afterEach(() => {
    adapter.onModuleDestroy();
    vi.useRealTimers();
  });

  describe('fixedWindow', () => {
    it('should allow requests up to the limit and reject beyond it', async () => {
      // Given
      const key = 'rl:fixed-window:user:1';

      // When
      const first = await adapter.fixedWindow(key, 2, 60);
      const second = await adapter.fixedWindow(key, 2, 60);
      const third = await adapter.fixedWindow(key, 2, 60);

      // Then
      expect(first.allowed).toBe(true);
      expect(first.remaining).toBe(1);
      expect(second.allowed).toBe(true);
      expect(second.remaining).toBe(0);
      expect(third.allowed).toBe(false);
      expect(third.current).toBe(3);
      expect(third.retryAfter).toBeGreaterThan(0);
    });

    it('should isolate counters per key', async () => {
      // When
      await adapter.fixedWindow('rl:fixed-window:a', 5, 60);
      const other = await adapter.fixedWindow('rl:fixed-window:b', 5, 60);

      // Then
      expect(other.current).toBe(1);
    });

    it('should reset the counter when the window rolls over', async () => {
      // Given
      const key = 'rl:fixed-window:roll';
      await adapter.fixedWindow(key, 1, 60);

      // When
      vi.advanceTimersByTime(61_000);
      const result = await adapter.fixedWindow(key, 1, 60);

      // Then
      expect(result.allowed).toBe(true);
      expect(result.current).toBe(1);
    });
  });

  describe('slidingWindow', () => {
    it('should allow requests up to the limit and reject with retryAfter', async () => {
      // Given
      const key = 'rl:sliding-window:user:1';

      // When
      await adapter.slidingWindow(key, 2, 60);
      await adapter.slidingWindow(key, 2, 60);
      const rejected = await adapter.slidingWindow(key, 2, 60);

      // Then
      expect(rejected.allowed).toBe(false);
      expect(rejected.remaining).toBe(0);
      expect(rejected.retryAfter).toBe(60);
    });

    it('should allow again after the oldest request slides out of the window', async () => {
      // Given
      const key = 'rl:sliding-window:slide';
      await adapter.slidingWindow(key, 1, 60);

      // When
      vi.advanceTimersByTime(60_001);
      const result = await adapter.slidingWindow(key, 1, 60);

      // Then
      expect(result.allowed).toBe(true);
      expect(result.current).toBe(1);
    });
  });

  describe('tokenBucket', () => {
    it('should consume tokens and reject when the bucket is empty', async () => {
      // Given
      const key = 'rl:token-bucket:user:1';

      // When
      const first = await adapter.tokenBucket(key, 2, 0.001, 1);
      const second = await adapter.tokenBucket(key, 2, 0.001, 1);
      const third = await adapter.tokenBucket(key, 2, 0.001, 1);

      // Then
      expect(first.allowed).toBe(true);
      expect(first.remaining).toBe(1);
      expect(second.allowed).toBe(true);
      expect(second.remaining).toBe(0);
      expect(third.allowed).toBe(false);
      expect(third.retryAfter).toBeGreaterThan(0);
    });

    it('should refill tokens over time', async () => {
      // Given
      const key = 'rl:token-bucket:refill';
      await adapter.tokenBucket(key, 1, 1, 1); // drained

      // When — 1s refills 1 token
      vi.advanceTimersByTime(1000);
      const result = await adapter.tokenBucket(key, 1, 1, 1);

      // Then
      expect(result.allowed).toBe(true);
    });

    it('should default consume to 1 token', async () => {
      // When
      const result = await adapter.tokenBucket('rl:token-bucket:def', 5, 1);

      // Then
      expect(result.remaining).toBe(4);
    });
  });

  describe('peek', () => {
    it('should not consume for any algorithm', async () => {
      // Given
      await adapter.fixedWindow('k:fixed', 5, 60);
      await adapter.slidingWindow('k:sliding', 5, 60);
      await adapter.tokenBucket('k:bucket', 5, 1, 1);

      // When
      const fixed = await adapter.peek('k:fixed', 'fixed-window', { points: 5, duration: 60 });
      const fixedAgain = await adapter.peek('k:fixed', 'fixed-window', { points: 5, duration: 60 });
      const sliding = await adapter.peek('k:sliding', 'sliding-window', { points: 5, duration: 60 });
      const bucket = await adapter.peek('k:bucket', 'token-bucket', { capacity: 5, refillRate: 1 });

      // Then
      expect(fixed.current).toBe(1);
      expect(fixedAgain.current).toBe(1);
      expect(sliding.current).toBe(1);
      expect(bucket.remaining).toBe(4);
    });

    it('should report empty state for unknown keys', async () => {
      // When
      const result = await adapter.peek('missing', 'sliding-window', { points: 10, duration: 60 });

      // Then
      expect(result.current).toBe(0);
      expect(result.remaining).toBe(10);
      expect(result.allowed).toBe(true);
    });
  });

  describe('reset', () => {
    it('should clear the counter for the given key only', async () => {
      // Given
      await adapter.fixedWindow('rl:fixed-window:a', 1, 60);
      await adapter.fixedWindow('rl:fixed-window:b', 1, 60);

      // When
      await adapter.reset('rl:fixed-window:a');

      // Then
      const a = await adapter.fixedWindow('rl:fixed-window:a', 1, 60);
      const b = await adapter.fixedWindow('rl:fixed-window:b', 1, 60);
      expect(a.allowed).toBe(true);
      expect(b.allowed).toBe(false);
    });

    it('should be a no-op for unknown keys', async () => {
      // When/Then — must not throw
      await expect(adapter.reset('never-seen')).resolves.toBeUndefined();
    });
  });

  describe('key cap (memory-DoS protection)', () => {
    it('should evict the oldest entry when maxKeys is exceeded', async () => {
      // Given
      const small = new InMemoryRateLimitStoreAdapter({ memory: { maxKeys: 3, sweepIntervalMs: 30_000 } });
      await small.fixedWindow('k1', 5, 60);
      await small.fixedWindow('k2', 5, 60);
      await small.fixedWindow('k3', 5, 60);

      // When — 4th distinct key evicts the oldest (k1)
      await small.fixedWindow('k4', 5, 60);

      // Then
      const k1 = await small.peek('k1', 'fixed-window', { points: 5, duration: 60 });
      const k2 = await small.peek('k2', 'fixed-window', { points: 5, duration: 60 });
      expect(k1.current).toBe(0);
      expect(k2.current).toBe(1);
      expect(small.size).toBeLessThanOrEqual(3);

      small.onModuleDestroy();
    });

    it('should not evict when updating an existing key at the cap', async () => {
      // Given
      const small = new InMemoryRateLimitStoreAdapter({ memory: { maxKeys: 2, sweepIntervalMs: 30_000 } });
      await small.fixedWindow('k1', 5, 60);
      await small.fixedWindow('k2', 5, 60);

      // When
      await small.fixedWindow('k2', 5, 60);

      // Then
      const k1 = await small.peek('k1', 'fixed-window', { points: 5, duration: 60 });
      expect(k1.current).toBe(1);
      expect(small.size).toBe(2);

      small.onModuleDestroy();
    });
  });

  describe('expiry sweep', () => {
    it('should remove expired entries on the sweep interval', async () => {
      // Given
      await adapter.slidingWindow('sweep:1', 5, 1); // expires after 1s
      await adapter.slidingWindow('sweep:2', 5, 1);
      expect(adapter.size).toBe(2);

      // When — advance past expiry AND past the sweep interval
      vi.advanceTimersByTime(31_000);

      // Then
      expect(adapter.size).toBe(0);
    });

    it('should keep live entries during sweep', async () => {
      // Given
      await adapter.slidingWindow('live', 5, 3600);
      await adapter.slidingWindow('dead', 5, 1);

      // When
      vi.advanceTimersByTime(31_000);

      // Then
      expect(adapter.size).toBe(1);
      const live = await adapter.peek('live', 'sliding-window', { points: 5, duration: 3600 });
      expect(live.current).toBe(1);
    });

    it('should lazily treat expired entries as absent before the sweep runs', async () => {
      // Given
      await adapter.slidingWindow('lazy', 1, 1);

      // When — entry expired but sweep has not fired yet
      vi.advanceTimersByTime(1500);
      const result = await adapter.slidingWindow('lazy', 1, 1);

      // Then
      expect(result.allowed).toBe(true);
    });
  });

  describe('lifecycle', () => {
    it('should stop the sweep timer on module destroy', async () => {
      // Given
      await adapter.fixedWindow('any', 5, 60);

      // When
      adapter.onModuleDestroy();

      // Then
      expect(vi.getTimerCount()).toBe(0);
    });

    it('should work with empty options (built-in defaults)', async () => {
      // Given
      const bare = new InMemoryRateLimitStoreAdapter({});

      // When
      const result = await bare.fixedWindow('k', 5, 60);

      // Then
      expect(result.allowed).toBe(true);
      bare.onModuleDestroy();
    });

    it('should be safe to destroy twice', () => {
      // When/Then
      adapter.onModuleDestroy();
      expect(() => adapter.onModuleDestroy()).not.toThrow();
    });
  });
});
