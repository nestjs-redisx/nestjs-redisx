import { describe, it, expect } from 'vitest';
import { applyFixedWindow, applySlidingWindow, applyTokenBucket, peekFixedWindow, peekSlidingWindow, peekTokenBucket, isEntryExpired, type IMemoryRateLimitEntry } from '../../src/rate-limit/domain/memory/in-memory-algorithms';

/**
 * Parity contract: every result produced by these pure functions must match
 * what the Lua scripts + RedisRateLimitStoreAdapter parse* helpers produce
 * for the same inputs, including rounding quirks and the `retryAfter`
 * 0 -> undefined mapping.
 */

// 1_700_000_000_000 ms => 1_700_000_000 s; floor(1700000000/60)*60 = 1_699_999_980
const NOW = 1_700_000_000_000;
const WINDOW_START = 1_699_999_980;

describe('in-memory-algorithms', () => {
  describe('applyFixedWindow', () => {
    it('should allow first request and start a new window', () => {
      // Given
      const entry = undefined;

      // When
      const { entry: next, result } = applyFixedWindow(entry, NOW, 100, 60);

      // Then
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(100);
      expect(result.remaining).toBe(99);
      expect(result.current).toBe(1);
      expect(result.reset).toBe(WINDOW_START + 60);
      expect(result.retryAfter).toBeUndefined();
      expect(next.kind).toBe('fixed');
      if (next.kind === 'fixed') {
        expect(next.window).toBe(WINDOW_START);
        expect(next.count).toBe(1);
      }
      expect(next.expiresAt).toBe((WINDOW_START + 60) * 1000);
    });

    it('should increment the counter within the same window', () => {
      // Given
      const { entry: first } = applyFixedWindow(undefined, NOW, 100, 60);

      // When
      const { entry: second, result } = applyFixedWindow(first, NOW + 1000, 100, 60);

      // Then
      expect(result.current).toBe(2);
      expect(result.remaining).toBe(98);
      if (second.kind === 'fixed') {
        expect(second.count).toBe(2);
      }
    });

    it('should reject when the counter exceeds max points and keep counting (Lua INCR parity)', () => {
      // Given
      let entry: IMemoryRateLimitEntry | undefined;
      for (let i = 0; i < 2; i++) {
        entry = applyFixedWindow(entry, NOW, 2, 60).entry;
      }

      // When
      const { entry: after, result } = applyFixedWindow(entry, NOW, 2, 60);

      // Then — Lua INCRs even on reject: current keeps growing
      expect(result.allowed).toBe(false);
      expect(result.current).toBe(3);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBe(Math.ceil(WINDOW_START + 60 - NOW / 1000));
      if (after.kind === 'fixed') {
        expect(after.count).toBe(3);
      }
    });

    it('should start a fresh window when time crosses the window boundary', () => {
      // Given
      const { entry } = applyFixedWindow(undefined, NOW, 2, 60);
      const nextWindowNow = (WINDOW_START + 60) * 1000 + 500;

      // When
      const { entry: fresh, result } = applyFixedWindow(entry, nextWindowNow, 2, 60);

      // Then
      expect(result.allowed).toBe(true);
      expect(result.current).toBe(1);
      expect(result.reset).toBe(WINDOW_START + 120);
      if (fresh.kind === 'fixed') {
        expect(fresh.window).toBe(WINDOW_START + 60);
        expect(fresh.count).toBe(1);
      }
    });

    it('should treat an entry of a different kind as absent (algorithm-prefixed keys never collide in practice)', () => {
      // Given
      const bucketEntry = applyTokenBucket(undefined, NOW, 10, 1, 1).entry;

      // When
      const { result } = applyFixedWindow(bucketEntry, NOW, 100, 60);

      // Then
      expect(result.current).toBe(1);
      expect(result.allowed).toBe(true);
    });
  });

  describe('applySlidingWindow', () => {
    it('should allow first request and record its timestamp', () => {
      // Given
      const entry = undefined;

      // When
      const { entry: next, result } = applySlidingWindow(entry, NOW, 100, 60);

      // Then
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(100);
      expect(result.remaining).toBe(99);
      expect(result.current).toBe(1);
      expect(result.reset).toBe(Math.ceil((NOW + 60_000) / 1000));
      expect(result.retryAfter).toBeUndefined();
      if (next.kind === 'sliding') {
        expect(next.timestamps).toEqual([NOW]);
      }
      expect(next.expiresAt).toBe(NOW + 60_000);
    });

    it('should reject when the window is full and NOT record the rejected request (no ZADD on reject)', () => {
      // Given
      let entry: IMemoryRateLimitEntry | undefined;
      entry = applySlidingWindow(entry, NOW, 2, 60).entry;
      entry = applySlidingWindow(entry, NOW + 1000, 2, 60).entry;

      // When
      const { entry: after, result } = applySlidingWindow(entry, NOW + 2000, 2, 60);

      // Then
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.current).toBe(2);
      // retry_after = ceil((oldest + duration - now) / 1000) = ceil((NOW + 60000 - (NOW+2000))/1000) = 58
      expect(result.retryAfter).toBe(58);
      if (after.kind === 'sliding') {
        expect(after.timestamps).toEqual([NOW, NOW + 1000]);
      }
    });

    it('should slide: expire old timestamps strictly older than now - duration', () => {
      // Given — Lua ZREMRANGEBYSCORE -inf..window_start is inclusive: score == window_start is removed
      let entry: IMemoryRateLimitEntry | undefined;
      entry = applySlidingWindow(entry, NOW, 2, 60).entry;
      entry = applySlidingWindow(entry, NOW + 1000, 2, 60).entry;

      // When — exactly 60s after the first timestamp: NOW == boundary, gets pruned
      const { result } = applySlidingWindow(entry, NOW + 60_000, 2, 60);

      // Then
      expect(result.allowed).toBe(true);
      expect(result.current).toBe(2); // NOW+1000 survived, new one added
    });

    it('should refresh expiry on allow and keep it on reject (PEXPIRE only in allow branch)', () => {
      // Given
      const { entry: first } = applySlidingWindow(undefined, NOW, 1, 60);

      // When
      const { entry: afterReject } = applySlidingWindow(first, NOW + 5000, 1, 60);
      const { entry: afterAllow } = applySlidingWindow(first, NOW + 61_000, 1, 60);

      // Then
      expect(afterReject.expiresAt).toBe(NOW + 60_000);
      expect(afterAllow.expiresAt).toBe(NOW + 61_000 + 60_000);
    });

    it('should reject with undefined retryAfter when points is 0 (empty set => Lua retry_after 0 => undefined)', () => {
      // When
      const { result } = applySlidingWindow(undefined, NOW, 0, 60);

      // Then
      expect(result.allowed).toBe(false);
      expect(result.current).toBe(0);
      expect(result.retryAfter).toBeUndefined();
    });
  });

  describe('applyTokenBucket', () => {
    it('should start with a full bucket and consume one token', () => {
      // Given
      const entry = undefined;

      // When
      const { entry: next, result } = applyTokenBucket(entry, NOW, 10, 1, 1);

      // Then
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(10);
      expect(result.remaining).toBe(9);
      expect(result.current).toBe(10); // Lua returns floor(pre-consume tokens) as `current`
      expect(result.retryAfter).toBeUndefined();
      // time_to_full = (10 - 9) / 1 = 1s => reset = ceil(now/1000 + 1)
      expect(result.reset).toBe(Math.ceil(NOW / 1000 + 1));
      if (next.kind === 'bucket') {
        expect(next.tokens).toBe(9);
        expect(next.lastRefill).toBe(NOW);
      }
      // PEXPIRE ceil(capacity / refill * 1000) + 1000
      expect(next.expiresAt).toBe(NOW + Math.ceil((10 / 1) * 1000) + 1000);
    });

    it('should refill tokens based on elapsed time, capped at capacity', () => {
      // Given
      const { entry } = applyTokenBucket(undefined, NOW, 10, 2, 1); // 9 tokens left

      // When — 3s later: 9 + 3*2 = 15 -> capped at 10, consume 1 => 9
      const { entry: next, result } = applyTokenBucket(entry, NOW + 3000, 10, 2, 1);

      // Then
      expect(result.allowed).toBe(true);
      expect(result.current).toBe(10);
      expect(result.remaining).toBe(9);
      if (next.kind === 'bucket') {
        expect(next.tokens).toBe(9);
      }
    });

    it('should reject without consuming but still persist the refilled state (Lua HMSET on both branches)', () => {
      // Given — capacity 2, drain it
      let entry: IMemoryRateLimitEntry | undefined;
      entry = applyTokenBucket(entry, NOW, 2, 0.5, 1).entry;
      entry = applyTokenBucket(entry, NOW, 2, 0.5, 1).entry; // 0 tokens

      // When — 1s later: 0 + 0.5 = 0.5 tokens, need 1 => reject
      const { entry: after, result } = applyTokenBucket(entry, NOW + 1000, 2, 0.5, 1);

      // Then
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0); // floor(0.5)
      expect(result.current).toBe(0); // floor(pre-consume 0.5)
      // retry_after = ceil((1 - 0.5) / 0.5) = 1
      expect(result.retryAfter).toBe(1);
      if (after.kind === 'bucket') {
        expect(after.tokens).toBe(0.5);
        expect(after.lastRefill).toBe(NOW + 1000);
      }
    });

    it('should support fractional accumulation across calls', () => {
      // Given
      let entry: IMemoryRateLimitEntry | undefined;
      entry = applyTokenBucket(entry, NOW, 5, 0.1, 1).entry; // 4 tokens

      // When — 2500ms later: 4 + 0.25 = 4.25, consume 1 => 3.25
      const { entry: next } = applyTokenBucket(entry, NOW + 2500, 5, 0.1, 1);

      // Then
      if (next?.kind === 'bucket') {
        expect(next.tokens).toBeCloseTo(3.25, 10);
      }
    });

    it('should treat an expired entry as a fresh full bucket', () => {
      // Given — drain bucket completely
      let entry: IMemoryRateLimitEntry | undefined;
      entry = applyTokenBucket(entry, NOW, 1, 1, 1).entry; // 0 tokens, expiresAt = NOW + 2000

      // When — after expiry
      const later = NOW + 10_000;
      const { result } = applyTokenBucket(isEntryExpired(entry, later) ? undefined : entry, later, 1, 1, 1);

      // Then
      expect(result.allowed).toBe(true);
      expect(result.current).toBe(1);
    });

    it('should consume multiple tokens when requested', () => {
      // When
      const { entry: next, result } = applyTokenBucket(undefined, NOW, 10, 1, 3);

      // Then
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(7);
      if (next.kind === 'bucket') {
        expect(next.tokens).toBe(7);
      }
    });
  });

  describe('peekFixedWindow', () => {
    it('should report zero usage for an empty window', () => {
      // When
      const result = peekFixedWindow(undefined, NOW, 100, 60);

      // Then
      expect(result.allowed).toBe(true);
      expect(result.current).toBe(0);
      expect(result.remaining).toBe(100);
      expect(result.reset).toBe(WINDOW_START + 60);
    });

    it('should report current usage without consuming', () => {
      // Given
      const { entry } = applyFixedWindow(undefined, NOW, 100, 60);

      // When
      const result = peekFixedWindow(entry, NOW, 100, 60);

      // Then — allowed uses strict < (Redis adapter peek parity)
      expect(result.current).toBe(1);
      expect(result.remaining).toBe(99);
      expect(result.allowed).toBe(true);
    });

    it('should report not-allowed when current reached points (strict < parity with Redis peek)', () => {
      // Given
      let entry: IMemoryRateLimitEntry | undefined;
      entry = applyFixedWindow(entry, NOW, 1, 60).entry;

      // When
      const result = peekFixedWindow(entry, NOW, 1, 60);

      // Then
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should ignore an entry from a previous window', () => {
      // Given
      const { entry } = applyFixedWindow(undefined, NOW, 1, 60);

      // When
      const result = peekFixedWindow(entry, (WINDOW_START + 60) * 1000 + 1, 1, 60);

      // Then
      expect(result.current).toBe(0);
      expect(result.allowed).toBe(true);
    });
  });

  describe('peekSlidingWindow', () => {
    it('should count only live timestamps without consuming', () => {
      // Given
      let entry: IMemoryRateLimitEntry | undefined;
      entry = applySlidingWindow(entry, NOW, 10, 60).entry;
      entry = applySlidingWindow(entry, NOW + 1000, 10, 60).entry;

      // When
      const result = peekSlidingWindow(entry, NOW + 2000, 10, 60);

      // Then
      expect(result.current).toBe(2);
      expect(result.remaining).toBe(8);
      expect(result.allowed).toBe(true);
      // Redis peek parity: floor(now/1000) + duration
      expect(result.reset).toBe(Math.floor((NOW + 2000) / 1000) + 60);
    });

    it('should exclude timestamps that slid out of the window', () => {
      // Given
      let entry: IMemoryRateLimitEntry | undefined;
      entry = applySlidingWindow(entry, NOW, 10, 60).entry;

      // When
      const result = peekSlidingWindow(entry, NOW + 61_000, 10, 60);

      // Then
      expect(result.current).toBe(0);
      expect(result.remaining).toBe(10);
    });
  });

  describe('peekTokenBucket', () => {
    it('should report a full bucket when no entry exists', () => {
      // When
      const result = peekTokenBucket(undefined, NOW, 10, 1);

      // Then
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(10);
      expect(result.current).toBe(0); // Redis peek parity: current = capacity - remaining
      expect(result.reset).toBe(Math.ceil(NOW / 1000));
    });

    it('should apply refill without consuming', () => {
      // Given
      let entry: IMemoryRateLimitEntry | undefined;
      entry = applyTokenBucket(entry, NOW, 10, 2, 1).entry; // 9 tokens

      // When — 500ms later: 9 + 1 = 10 (capped)
      const result = peekTokenBucket(entry, NOW + 500, 10, 2);

      // Then
      expect(result.remaining).toBe(10);
      expect(result.current).toBe(0);
      expect(result.allowed).toBe(true);
    });

    it('should report not-allowed when fewer than one token is available', () => {
      // Given
      let entry: IMemoryRateLimitEntry | undefined;
      entry = applyTokenBucket(entry, NOW, 1, 0.1, 1).entry; // 0 tokens

      // When
      const result = peekTokenBucket(entry, NOW + 1000, 1, 0.1);

      // Then
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });
  });

  describe('isEntryExpired', () => {
    it('should report false before expiresAt and true after', () => {
      // Given
      const { entry } = applySlidingWindow(undefined, NOW, 10, 60);

      // Then
      expect(isEntryExpired(entry, NOW + 59_999)).toBe(false);
      expect(isEntryExpired(entry, NOW + 60_000)).toBe(true);
    });
  });
});
