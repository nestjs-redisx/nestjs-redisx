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
    eval: vi.fn().mockResolvedValue(1),
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
    it('should run the acquire script with permit id, capacity, now, and ttl', async () => {
      // When
      const acquired = await adapter.acquire('_sem:k', 'p1', 3, 30_000, 1_000);

      // Then
      expect(acquired).toBe(true);
      expect(driver.evalsha).toHaveBeenCalledWith(expect.any(String), ['_sem:k'], ['p1', 3, 1_000, 30_000]);
    });

    it('should map a 0 reply to false (semaphore full)', async () => {
      // Given
      driver.evalsha.mockResolvedValue(0);

      // When/Then
      expect(await adapter.acquire('_sem:k', 'p1', 1, 1_000, 0)).toBe(false);
    });

    it('should fall back to EVAL on NOSCRIPT and still succeed', async () => {
      // Given — script cache flushed between load and call
      driver.evalsha.mockRejectedValueOnce(new Error('NOSCRIPT No matching script'));
      driver.eval.mockResolvedValue(1);

      // When
      const acquired = await adapter.acquire('_sem:k', 'p1', 2, 5_000, 10);

      // Then
      expect(acquired).toBe(true);
      expect(driver.eval).toHaveBeenCalledWith(ACQUIRE_PERMIT_SCRIPT, ['_sem:k'], ['p1', 2, 10, 5_000]);
    });

    it('should rethrow non-NOSCRIPT errors untouched', async () => {
      // Given
      driver.evalsha.mockRejectedValue(new Error('READONLY You cannot write against a replica'));

      // When/Then
      await expect(adapter.acquire('_sem:k', 'p1', 2, 5_000, 10)).rejects.toThrow('READONLY');
      expect(driver.eval).not.toHaveBeenCalled();
    });
  });

  describe('release / extend / counts', () => {
    it('should release via the release script', async () => {
      expect(await adapter.release('_sem:k', 'p1')).toBe(true);
      expect(driver.evalsha).toHaveBeenCalledWith(expect.any(String), ['_sem:k'], ['p1']);
    });

    it('should extend via the extend script with injected now', async () => {
      expect(await adapter.extend('_sem:k', 'p1', 9_000, 123)).toBe(true);
      expect(driver.evalsha).toHaveBeenCalledWith(expect.any(String), ['_sem:k'], ['p1', 123, 9_000]);
    });

    it('should report usedPermits as a number', async () => {
      driver.evalsha.mockResolvedValue(4);
      expect(await adapter.usedPermits('_sem:k', 50)).toBe(4);
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
      expect(await adapter.usedPermits('_sem:k', 1)).toBe(0);
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

  describe('isHeld', () => {
    it('should be true only for an unexpired score', async () => {
      // Given
      driver.zscore.mockResolvedValue('1500');

      // When/Then
      expect(await adapter.isHeld('_sem:k', 'p1', 1_000)).toBe(true);
      expect(await adapter.isHeld('_sem:k', 'p1', 2_000)).toBe(false);
    });

    it('should be false for a missing member', async () => {
      // Given
      driver.zscore.mockResolvedValue(null);

      // When/Then
      expect(await adapter.isHeld('_sem:k', 'p1', 0)).toBe(false);
    });
  });
});
