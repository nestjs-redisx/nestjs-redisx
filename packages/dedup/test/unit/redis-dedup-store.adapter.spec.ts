import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RedisDedupStoreAdapter } from '../../src/dedup/infrastructure/adapters/redis-dedup-store.adapter';
import { RELEASE_IF_OWNER_SCRIPT, CLAIM_LAST_CALL_SCRIPT } from '../../src/dedup/infrastructure/scripts/lua-scripts';

interface MockDriver {
  scriptLoad: ReturnType<typeof vi.fn>;
  evalsha: ReturnType<typeof vi.fn>;
  eval: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
}

function createMockDriver(): MockDriver {
  return {
    scriptLoad: vi.fn().mockImplementation(async (script: string) => `sha:${script.length}`),
    evalsha: vi.fn().mockResolvedValue(1),
    eval: vi.fn().mockResolvedValue(1),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
  };
}

describe('RedisDedupStoreAdapter', () => {
  let driver: MockDriver;
  let adapter: RedisDedupStoreAdapter;

  beforeEach(() => {
    driver = createMockDriver();
    adapter = new RedisDedupStoreAdapter(driver as never);
  });

  describe('onModuleInit', () => {
    it('should pre-load both scripts and survive a pre-load failure', async () => {
      // When
      await adapter.onModuleInit();

      // Then
      expect(driver.scriptLoad).toHaveBeenCalledWith(RELEASE_IF_OWNER_SCRIPT);
      expect(driver.scriptLoad).toHaveBeenCalledWith(CLAIM_LAST_CALL_SCRIPT);

      // And a LOADING hiccup never crashes bootstrap
      driver.scriptLoad.mockRejectedValue(new Error('LOADING'));
      await expect(adapter.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe('markFirst', () => {
    it('should SET NX PX and map OK/null', async () => {
      // When/Then — first
      expect(await adapter.markFirst('_dedup:k', 'tok', 5_000)).toBe(true);
      expect(driver.set).toHaveBeenCalledWith('_dedup:k', 'tok', { nx: true, px: 5_000 });

      // And duplicate (SET NX returns null)
      driver.set.mockResolvedValue(null);
      expect(await adapter.markFirst('_dedup:k', 'tok', 5_000)).toBe(false);
    });
  });

  describe('releaseIfOwner / claimLastCall', () => {
    it('should run the CAS release script', async () => {
      expect(await adapter.releaseIfOwner('_dedup:k', 'tok')).toBe(true);
      expect(driver.evalsha).toHaveBeenCalledWith(expect.any(String), ['_dedup:k'], ['tok']);
    });

    it('should map a refused claim (0) to false', async () => {
      driver.evalsha.mockResolvedValue(0);
      expect(await adapter.claimLastCall('_dedup:d', 'call-1')).toBe(false);
    });

    it('should fall back to EVAL on NOSCRIPT (message or cause)', async () => {
      // Given — NOSCRIPT inside a wrapper's cause
      const wrapped = new Error('Command EVALSHA failed');
      (wrapped as { cause?: Error }).cause = new Error('NOSCRIPT No matching script');
      driver.evalsha.mockRejectedValueOnce(wrapped);

      // When/Then
      expect(await adapter.claimLastCall('_dedup:d', 'call-1')).toBe(true);
      expect(driver.eval).toHaveBeenCalledWith(CLAIM_LAST_CALL_SCRIPT, ['_dedup:d'], ['call-1']);
    });

    it('should rethrow non-NOSCRIPT errors untouched', async () => {
      driver.evalsha.mockRejectedValue(new Error('READONLY'));
      await expect(adapter.releaseIfOwner('_dedup:k', 'tok')).rejects.toThrow('READONLY');
      expect(driver.eval).not.toHaveBeenCalled();
    });
  });

  describe('release / stampLastCall', () => {
    it('should DEL the marker and report existence', async () => {
      expect(await adapter.release('_dedup:k')).toBe(true);
      driver.del.mockResolvedValue(0);
      expect(await adapter.release('_dedup:k')).toBe(false);
    });

    it('should stamp the last call with SET PX (overwrite semantics)', async () => {
      await adapter.stampLastCall('_dedup:d', 'call-9', 21_000);
      expect(driver.set).toHaveBeenCalledWith('_dedup:d', 'call-9', { px: 21_000 });
    });
  });
});
