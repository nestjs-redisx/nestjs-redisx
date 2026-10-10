import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RedisSemaphoreStoreAdapter } from '../../src/semaphore/infrastructure/adapters/redis-semaphore-store.adapter';
import { ACQUIRE_PERMIT_SCRIPT, RELEASE_PERMIT_SCRIPT, EXTEND_PERMIT_SCRIPT, USED_PERMITS_SCRIPT, FORCE_RELEASE_ALL_SCRIPT } from '../../src/semaphore/infrastructure/scripts/lua-scripts';

interface MockDriver {
  scriptLoad: ReturnType<typeof vi.fn>;
  evalsha: ReturnType<typeof vi.fn>;
  eval: ReturnType<typeof vi.fn>;
  zscore: ReturnType<typeof vi.fn>;
}

function createMockDriver(): MockDriver {
  return {
    scriptLoad: vi.fn().mockImplementation(async (script: string) => `sha:${script.length}`),
    evalsha: vi.fn().mockResolvedValue(1),
    // eval serves both the NOSCRIPT fallback and the TIME clock sync.
    eval: vi.fn().mockImplementation(async (script: string) => (script.includes('time') ? [String(Math.floor(Date.now() / 1000)), '0'] : 1)),
    zscore: vi.fn().mockResolvedValue(null),
  };
}

describe('RedisSemaphoreStoreAdapter', () => {
  let driver: MockDriver;
  let adapter: RedisSemaphoreStoreAdapter;

  beforeEach(() => {
    driver = createMockDriver();
    adapter = new RedisSemaphoreStoreAdapter(driver as never);
  });

  describe('onModuleInit', () => {
    it('should pre-load all five scripts', async () => {
      // When
      await adapter.onModuleInit();

      // Then
      expect(driver.scriptLoad).toHaveBeenCalledTimes(5);
      for (const script of [ACQUIRE_PERMIT_SCRIPT, RELEASE_PERMIT_SCRIPT, EXTEND_PERMIT_SCRIPT, USED_PERMITS_SCRIPT, FORCE_RELEASE_ALL_SCRIPT]) {
        expect(driver.scriptLoad).toHaveBeenCalledWith(script);
      }
    });

    it('should warn and continue when pre-load fails (never crash bootstrap)', async () => {
      // Given — Redis LOADING right after a restart
      driver.scriptLoad.mockRejectedValue(new Error('LOADING Redis is loading the dataset'));

      // When/Then — no throw
      await expect(adapter.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe('acquire', () => {
    it('should run the acquire script with permit id, capacity, server-now, and ttl', async () => {
      // When
      const acquired = await adapter.acquire('_sem:k', 'p1', 3, 30_000);

      // Then — the adapter injects server-approximated time itself
      expect(acquired).toBe(true);
      expect(driver.evalsha).toHaveBeenCalledWith(expect.any(String), ['_sem:k'], ['p1', 3, expect.any(Number), 30_000]);
    });

    it('should map a 0 reply to false (semaphore full)', async () => {
      // Given
      driver.evalsha.mockResolvedValue(0);

      // When/Then
      expect(await adapter.acquire('_sem:k', 'p1', 1, 1_000)).toBe(false);
    });

    it('should fall back to EVAL on NOSCRIPT and still succeed', async () => {
      // Given — script cache flushed between load and call
      driver.evalsha.mockRejectedValueOnce(new Error('NOSCRIPT No matching script'));
      driver.eval.mockResolvedValue(1);

      // When
      const acquired = await adapter.acquire('_sem:k', 'p1', 2, 5_000);

      // Then
      expect(acquired).toBe(true);
      expect(driver.eval).toHaveBeenCalledWith(ACQUIRE_PERMIT_SCRIPT, ['_sem:k'], ['p1', 2, expect.any(Number), 5_000]);
    });

    it('should rethrow non-NOSCRIPT errors untouched', async () => {
      // Given
      driver.evalsha.mockRejectedValue(new Error('READONLY You cannot write against a replica'));

      // When/Then
      await expect(adapter.acquire('_sem:k', 'p1', 2, 5_000)).rejects.toThrow('READONLY');
      // No script fallback ran (the only eval traffic is the TIME clock sync)
      expect(driver.eval.mock.calls.some((c: unknown[]) => c[0] === ACQUIRE_PERMIT_SCRIPT)).toBe(false);
    });
  });

  describe('release / extend / counts', () => {
    it('should release via the expiry-aware release script (server-now injected)', async () => {
      expect(await adapter.release('_sem:k', 'p1')).toBe(true);
      expect(driver.evalsha).toHaveBeenCalledWith(expect.any(String), ['_sem:k'], ['p1', expect.any(Number)]);
    });

    it('should extend via the extend script with server-now injected', async () => {
      expect(await adapter.extend('_sem:k', 'p1', 9_000)).toBe(true);
      expect(driver.evalsha).toHaveBeenCalledWith(expect.any(String), ['_sem:k'], ['p1', expect.any(Number), 9_000]);
    });

    it('should report usedPermits as a number', async () => {
      driver.evalsha.mockResolvedValue(4);
      expect(await adapter.usedPermits('_sem:k')).toBe(4);
    });

    it('should report forceReleaseAll count', async () => {
      driver.evalsha.mockResolvedValue(2);
      expect(await adapter.forceReleaseAll('_sem:k')).toBe(2);
    });
  });

  describe('defensive parsing', () => {
    it('should map null script replies to 0 counts', async () => {
      // Given — drivers may surface null for a missing key
      driver.evalsha.mockResolvedValue(null);

      // When/Then
      expect(await adapter.usedPermits('_sem:k')).toBe(0);
      expect(await adapter.forceReleaseAll('_sem:k')).toBe(0);
    });

    it('should detect NOSCRIPT wrapped in an error cause (driver error envelopes)', async () => {
      // Given — CommandError-style wrapper with the NOSCRIPT in `cause`
      const wrapped = new Error('Command EVALSHA failed');
      (wrapped as { cause?: Error }).cause = new Error('NOSCRIPT No matching script');
      driver.evalsha.mockRejectedValueOnce(wrapped);
      driver.eval.mockResolvedValue(1);

      // When/Then
      expect(await adapter.release('_sem:k', 'p1')).toBe(true);
      expect(driver.eval).toHaveBeenCalled();
    });
  });

  describe('adversarial: script properties', () => {
    it('usedPermits must stay READ-ONLY (works under maxmemory/denyoom and on read paths)', () => {
      // A write inside the count script (sweep/del/pexpire) makes a pure
      // read API fail under OOM pressure — counting must use a range read.
      expect(USED_PERMITS_SCRIPT).not.toMatch(/zremrangebyscore|zadd|pexpire|del/);
      expect(USED_PERMITS_SCRIPT).toMatch(/zcount/);
    });
  });

  describe('isHeld', () => {
    it('should be true only for an unexpired score (vs server-now)', async () => {
      // Given — one live, one expired
      driver.zscore.mockResolvedValue(String(Date.now() + 60_000));
      expect(await adapter.isHeld('_sem:k', 'p1')).toBe(true);

      driver.zscore.mockResolvedValue(String(Date.now() - 60_000));
      expect(await adapter.isHeld('_sem:k', 'p1')).toBe(false);
    });

    it('should be false for a missing member', async () => {
      // Given
      driver.zscore.mockResolvedValue(null);

      // When/Then
      expect(await adapter.isHeld('_sem:k', 'p1')).toBe(false);
    });
  });

  describe('server clock sync', () => {
    it('should sync the offset via TIME once and apply it to injected now', async () => {
      // Given — the server clock is 10s AHEAD of the local one
      const skewedSec = Math.floor((Date.now() + 10_000) / 1000);
      driver.eval.mockImplementation(async (script: string) => (script.includes('time') ? [String(skewedSec), '0'] : 1));

      // When
      await adapter.acquire('_sem:k', 'p1', 1, 1_000);

      // Then — injected now is server-approximated, not the local clock
      const injectedNow = driver.evalsha.mock.calls[0]![2][2] as number;
      expect(injectedNow).toBeGreaterThan(Date.now() + 8_000);
    });

    it('should keep the previous offset when TIME fails (and never poison now)', async () => {
      // Given — TIME is unavailable (e.g. the in-memory driver without it)
      driver.eval.mockImplementation(async (script: string) => {
        if (script.includes('time')) throw new Error('unknown command');
        return 1;
      });

      // When/Then — operation still works with the local clock
      expect(await adapter.acquire('_sem:k', 'p1', 1, 1_000)).toBe(true);
      const injectedNow = driver.evalsha.mock.calls[0]![2][2] as number;
      expect(Number.isFinite(injectedNow)).toBe(true);
    });
  });
});
