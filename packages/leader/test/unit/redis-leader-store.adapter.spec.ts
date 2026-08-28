import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';
import type { IRedisDriver } from '@nestjs-redisx/core';
import { RedisLeaderStoreAdapter } from '../../src/leader/infrastructure/adapters/redis-leader-store.adapter';
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
    it('should pre-load the renew and release Lua scripts', async () => {
      // When
      await adapter.onModuleInit();

      // Then
      expect(mockDriver.scriptLoad).toHaveBeenCalledTimes(2);
      expect(mockDriver.scriptLoad).toHaveBeenCalledWith(expect.stringContaining('pexpire'));
      expect(mockDriver.scriptLoad).toHaveBeenCalledWith(expect.stringContaining('del'));
    });

    it('should throw LeaderStoreError when script loading fails', async () => {
      // Given
      mockDriver.scriptLoad.mockRejectedValue(new Error('down'));

      // When/Then
      await expect(adapter.onModuleInit()).rejects.toThrow(LeaderStoreError);
    });
  });

  describe('acquire', () => {
    it('should acquire via SET NX PX and report success on OK', async () => {
      // Given
      mockDriver.set.mockResolvedValue('OK');

      // When
      const acquired = await adapter.acquire('leader:default', 'node-1', 15_000);

      // Then
      expect(acquired).toBe(true);
      expect(mockDriver.set).toHaveBeenCalledWith('leader:default', 'node-1', { nx: true, px: 15_000 });
    });

    it('should report failure when the key is already held', async () => {
      // Given
      mockDriver.set.mockResolvedValue(null);

      // When
      const acquired = await adapter.acquire('leader:default', 'node-1', 15_000);

      // Then
      expect(acquired).toBe(false);
    });

    it('should throw LeaderStoreError on driver failure', async () => {
      // Given
      mockDriver.set.mockRejectedValue(new Error('connection refused'));

      // When/Then
      await expect(adapter.acquire('leader:default', 'node-1', 15_000)).rejects.toThrow(LeaderStoreError);
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
