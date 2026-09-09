import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';
import type { IRedisDriver } from '@nestjs-redisx/core';
import { RedisLeaderStoreAdapter } from '../../src/leader/infrastructure/adapters/redis-leader-store.adapter';
import { ACQUIRE_LEADER_SCRIPT, RENEW_LEADER_SCRIPT, RELEASE_LEADER_SCRIPT } from '../../src/leader/infrastructure/scripts/lua-scripts';
import { LeaderStoreError } from '../../src/shared/errors';

describe('RedisLeaderStoreAdapter', () => {
  let adapter: RedisLeaderStoreAdapter;
  let mockDriver: MockedObject<IRedisDriver>;

  beforeEach(() => {
    mockDriver = {
      set: vi.fn(),
      get: vi.fn(),
      scriptLoad: vi.fn().mockResolvedValue('sha1'),
      evalsha: vi.fn(),
      eval: vi.fn(),
    } as unknown as MockedObject<IRedisDriver>;

    adapter = new RedisLeaderStoreAdapter(mockDriver);
  });

  describe('onModuleInit', () => {
    it('should pre-load the acquire, renew, and release Lua scripts', async () => {
      // When
      await adapter.onModuleInit();

      // Then
      expect(mockDriver.scriptLoad).toHaveBeenCalledTimes(3);
      expect(mockDriver.scriptLoad).toHaveBeenCalledWith(ACQUIRE_LEADER_SCRIPT);
      expect(mockDriver.scriptLoad).toHaveBeenCalledWith(RENEW_LEADER_SCRIPT);
      expect(mockDriver.scriptLoad).toHaveBeenCalledWith(RELEASE_LEADER_SCRIPT);
    });

    it('should NOT fail bootstrap when script loading fails — it degrades to plain EVAL', async () => {
      // Given — Redis hiccups exactly during init (LOADING, brief failover)
      mockDriver.scriptLoad.mockRejectedValue(new Error('LOADING Redis is loading the dataset in memory'));

      // When — init completes without throwing (a transient hiccup must not
      // crash-loop the whole application; the loop contains store errors)
      await expect(adapter.onModuleInit()).resolves.toBeUndefined();

      // Then — operations still work through the sha-less EVAL path
      mockDriver.eval.mockResolvedValue(1);
      await expect(adapter.acquire('leader:default', 'node-1', 15000)).resolves.toBe(true);
      expect(mockDriver.eval).toHaveBeenCalled();
      expect(mockDriver.evalsha).not.toHaveBeenCalled();
    });
  });

  describe('acquire', () => {
    beforeEach(async () => {
      await adapter.onModuleInit();
    });

    it('should acquire via the acquire-or-reclaim script and report success on 1', async () => {
      // Given
      mockDriver.evalsha.mockResolvedValue(1);

      // When
      const acquired = await adapter.acquire('leader:default', 'node-1', 15_000);

      // Then
      expect(acquired).toBe(true);
      expect(mockDriver.evalsha).toHaveBeenCalledWith('sha1', ['leader:default'], ['node-1', 15_000]);
    });

    it('should report failure when the key is held by someone else', async () => {
      // Given
      mockDriver.evalsha.mockResolvedValue(0);

      // When
      const acquired = await adapter.acquire('leader:default', 'node-1', 15_000);

      // Then
      expect(acquired).toBe(false);
    });

    it('should fall back to eval on NOSCRIPT', async () => {
      // Given
      mockDriver.evalsha.mockRejectedValue(new Error('NOSCRIPT No matching script'));
      mockDriver.eval.mockResolvedValue(1);

      // When
      const acquired = await adapter.acquire('leader:default', 'node-1', 15_000);

      // Then
      expect(acquired).toBe(true);
      expect(mockDriver.eval).toHaveBeenCalledWith(ACQUIRE_LEADER_SCRIPT, ['leader:default'], ['node-1', 15_000]);
    });

    it('should throw LeaderStoreError on driver failure', async () => {
      // Given
      mockDriver.evalsha.mockRejectedValue(new Error('connection refused'));

      // When/Then
      await expect(adapter.acquire('leader:default', 'node-1', 15_000)).rejects.toThrow(LeaderStoreError);
    });
  });

  describe('before onModuleInit (no cached sha)', () => {
    it('should EVAL the acquire script directly instead of EVALSHA(null)', async () => {
      // Given — adapter constructed but never initialized
      mockDriver.eval.mockResolvedValue(1);

      // When
      const acquired = await adapter.acquire('leader:default', 'node-1', 15_000);

      // Then
      expect(acquired).toBe(true);
      expect(mockDriver.evalsha).not.toHaveBeenCalled();
      expect(mockDriver.eval).toHaveBeenCalledWith(ACQUIRE_LEADER_SCRIPT, ['leader:default'], ['node-1', 15_000]);
    });

    it('should wrap direct-EVAL failures in LeaderStoreError', async () => {
      // Given
      mockDriver.eval.mockRejectedValue(new Error('down'));

      // When/Then
      await expect(adapter.renew('leader:default', 'node-1', 15_000)).rejects.toThrow(LeaderStoreError);
    });
  });

  describe('renew', () => {
    beforeEach(async () => {
      await adapter.onModuleInit();
    });

    it('should renew via the CAS script and report success on 1', async () => {
      // Given
      mockDriver.evalsha.mockResolvedValue(1);

      // When
      const renewed = await adapter.renew('leader:default', 'node-1', 15_000);

      // Then
      expect(renewed).toBe(true);
      expect(mockDriver.evalsha).toHaveBeenCalledWith('sha1', ['leader:default'], ['node-1', 15_000]);
    });

    it('should report failure when the key is held by someone else', async () => {
      // Given
      mockDriver.evalsha.mockResolvedValue(0);

      // When
      const renewed = await adapter.renew('leader:default', 'node-1', 15_000);

      // Then
      expect(renewed).toBe(false);
    });

    it('should fall back to eval on NOSCRIPT', async () => {
      // Given
      mockDriver.evalsha.mockRejectedValue(new Error('NOSCRIPT No matching script'));
      mockDriver.eval.mockResolvedValue(1);

      // When
      const renewed = await adapter.renew('leader:default', 'node-1', 15_000);

      // Then
      expect(renewed).toBe(true);
      expect(mockDriver.eval).toHaveBeenCalled();
    });

    it('should wrap NOSCRIPT-fallback failures in LeaderStoreError too', async () => {
      // Given — the fallback eval itself fails with a connection error
      mockDriver.evalsha.mockRejectedValue(new Error('NOSCRIPT No matching script'));
      mockDriver.eval.mockRejectedValue(new Error('connection reset'));

      // When/Then
      await expect(adapter.renew('leader:default', 'node-1', 15_000)).rejects.toThrow(LeaderStoreError);
    });

    it('should throw LeaderStoreError on non-NOSCRIPT failure', async () => {
      // Given
      mockDriver.evalsha.mockRejectedValue(new Error('timeout'));

      // When/Then
      await expect(adapter.renew('leader:default', 'node-1', 15_000)).rejects.toThrow(LeaderStoreError);
    });
  });

  describe('release', () => {
    beforeEach(async () => {
      await adapter.onModuleInit();
    });

    it('should release via the CAS script only when owned', async () => {
      // Given
      mockDriver.evalsha.mockResolvedValue(1);

      // When
      const released = await adapter.release('leader:default', 'node-1');

      // Then
      expect(released).toBe(true);
    });

    it('should report false when not the owner', async () => {
      // Given
      mockDriver.evalsha.mockResolvedValue(0);

      // When
      const released = await adapter.release('leader:default', 'node-1');

      // Then
      expect(released).toBe(false);
    });

    it('should fall back to eval on NOSCRIPT', async () => {
      // Given
      mockDriver.evalsha.mockRejectedValue(new Error('NOSCRIPT'));
      mockDriver.eval.mockResolvedValue(1);

      // When
      const released = await adapter.release('leader:default', 'node-1');

      // Then
      expect(released).toBe(true);
      expect(mockDriver.eval).toHaveBeenCalled();
    });

    it('should throw LeaderStoreError on failure', async () => {
      // Given
      mockDriver.evalsha.mockRejectedValue(new Error('down'));

      // When/Then
      await expect(adapter.release('leader:default', 'node-1')).rejects.toThrow(LeaderStoreError);
    });
  });

  describe('getHolder', () => {
    it('should return the current holder id', async () => {
      // Given
      mockDriver.get.mockResolvedValue('node-2');

      // When
      const holder = await adapter.getHolder('leader:default');

      // Then
      expect(holder).toBe('node-2');
      expect(mockDriver.get).toHaveBeenCalledWith('leader:default');
    });

    it('should return null when nobody is leader', async () => {
      // Given
      mockDriver.get.mockResolvedValue(null);

      // When/Then
      expect(await adapter.getHolder('leader:default')).toBeNull();
    });

    it('should throw LeaderStoreError on failure', async () => {
      // Given
      mockDriver.get.mockRejectedValue(new Error('down'));

      // When/Then
      await expect(adapter.getHolder('leader:default')).rejects.toThrow(LeaderStoreError);
    });
  });
});
