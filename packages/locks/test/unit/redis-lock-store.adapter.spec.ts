import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';
import type { IRedisDriver } from '@nestjs-redisx/core';
import { RedisLockStoreAdapter } from '../../src/lock/infrastructure/adapters/redis-lock-store.adapter';

describe('RedisLockStoreAdapter', () => {
  let adapter: RedisLockStoreAdapter;
  let mockDriver: MockedObject<IRedisDriver>;

  beforeEach(() => {
    mockDriver = {
      set: vi.fn(),
      get: vi.fn(),
      del: vi.fn(),
      exists: vi.fn(),
      scriptLoad: vi.fn(),
      evalsha: vi.fn(),
    } as unknown as MockedObject<IRedisDriver>;

    adapter = new RedisLockStoreAdapter(mockDriver);
  });

  describe('onModuleInit', () => {
    it('should load Lua scripts on initialization', async () => {
      // Given
      mockDriver.scriptLoad.mockResolvedValueOnce('release-sha').mockResolvedValueOnce('extend-sha');

      // When
      await adapter.onModuleInit();

      // Then
      expect(mockDriver.scriptLoad).toHaveBeenCalledTimes(2);
      expect(mockDriver.scriptLoad).toHaveBeenCalledWith(expect.stringContaining('get'));
      expect(mockDriver.scriptLoad).toHaveBeenCalledWith(expect.stringContaining('pexpire'));
    });

    it('should cache script SHA hashes', async () => {
      // Given
      mockDriver.scriptLoad.mockResolvedValueOnce('release-sha').mockResolvedValueOnce('extend-sha');

      await adapter.onModuleInit();

      // When
      mockDriver.evalsha.mockResolvedValue(1);
      await adapter.release('key', 'token');

      // Then
      expect(mockDriver.evalsha).toHaveBeenCalledWith('release-sha', ['key'], ['token']);
    });
  });

  describe('acquire', () => {
    it('should acquire lock successfully', async () => {
      // Given
      const key = 'test-lock';
      const token = 'unique-token';
      const ttl = 30000;
      mockDriver.set.mockResolvedValue('OK');

      // When
      const result = await adapter.acquire(key, token, ttl);

      // Then
      expect(result).toBe(true);
      expect(mockDriver.set).toHaveBeenCalledWith(key, token, {
        nx: true,
        px: ttl,
      });
    });

    it('should fail when lock already exists', async () => {
      // Given
      const key = 'test-lock';
      const token = 'unique-token';
      const ttl = 30000;
      mockDriver.set.mockResolvedValue(null);

      // When
      const result = await adapter.acquire(key, token, ttl);

      // Then
      expect(result).toBe(false);
    });

    it('should use correct Redis options', async () => {
      // Given
      mockDriver.set.mockResolvedValue('OK');

      // When
      await adapter.acquire('key', 'token', 5000);

      // Then
      expect(mockDriver.set).toHaveBeenCalledWith('key', 'token', {
        nx: true,
        px: 5000,
      });
    });
  });

  describe('release', () => {
    it('should release lock using Lua script', async () => {
      // Given
      mockDriver.scriptLoad.mockResolvedValue('release-sha');
      await adapter.onModuleInit();

      mockDriver.evalsha.mockResolvedValue(1);

      // When
      const result = await adapter.release('key', 'token');

      // Then
      expect(result).toBe(true);
      expect(mockDriver.evalsha).toHaveBeenCalledWith('release-sha', ['key'], ['token']);
    });

    it('should return false when lock not owned', async () => {
      // Given
      mockDriver.scriptLoad.mockResolvedValue('release-sha');
      await adapter.onModuleInit();

      mockDriver.evalsha.mockResolvedValue(0);

      // When
      const result = await adapter.release('key', 'token');

      // Then
      expect(result).toBe(false);
    });

    it('should load script if not initialized', async () => {
      // Given
      mockDriver.scriptLoad.mockResolvedValue('release-sha');
      mockDriver.evalsha.mockResolvedValue(1);

      // When
      const result = await adapter.release('key', 'token');

      // Then
      expect(result).toBe(true);
      expect(mockDriver.scriptLoad).toHaveBeenCalledWith(expect.stringContaining('get'));
      expect(mockDriver.evalsha).toHaveBeenCalledWith('release-sha', ['key'], ['token']);
    });
  });

  describe('extend', () => {
    it('should extend lock TTL using Lua script', async () => {
      // Given
      mockDriver.scriptLoad.mockResolvedValue('extend-sha');
      await adapter.onModuleInit();

      mockDriver.evalsha.mockResolvedValue(1);

      // When
      const result = await adapter.extend('key', 'token', 60000);

      // Then
      expect(result).toBe(true);
      expect(mockDriver.evalsha).toHaveBeenCalledWith('extend-sha', ['key'], ['token', 60000]);
    });

    it('should return false when lock not owned', async () => {
      // Given
      mockDriver.scriptLoad.mockResolvedValue('extend-sha');
      await adapter.onModuleInit();

      mockDriver.evalsha.mockResolvedValue(0);

      // When
      const result = await adapter.extend('key', 'token', 60000);

      // Then
      expect(result).toBe(false);
    });

    it('should load script if not initialized', async () => {
      // Given
      mockDriver.scriptLoad.mockResolvedValue('extend-sha');
      mockDriver.evalsha.mockResolvedValue(1);

      // When
      const result = await adapter.extend('key', 'token', 30000);

      // Then
      expect(result).toBe(true);
      expect(mockDriver.scriptLoad).toHaveBeenCalledWith(expect.stringContaining('pexpire'));
      expect(mockDriver.evalsha).toHaveBeenCalledWith('extend-sha', ['key'], ['token', 30000]);
    });

    it('should pass TTL as number', async () => {
      // Given
      mockDriver.scriptLoad.mockResolvedValue('extend-sha');
      await adapter.onModuleInit();
      mockDriver.evalsha.mockResolvedValue(1);

      // When
      await adapter.extend('key', 'token', 45000);

      // Then
      expect(mockDriver.evalsha).toHaveBeenCalledWith('extend-sha', ['key'], ['token', 45000]);
    });
  });

  describe('exists', () => {
    it('should return true when lock exists', async () => {
      // Given
      mockDriver.exists.mockResolvedValue(1);

      // When
      const result = await adapter.exists('test-lock');

      // Then
      expect(result).toBe(true);
      expect(mockDriver.exists).toHaveBeenCalledWith('test-lock');
    });

    it('should return false when lock does not exist', async () => {
      // Given
      mockDriver.exists.mockResolvedValue(0);

      // When
      const result = await adapter.exists('test-lock');

      // Then
      expect(result).toBe(false);
    });
  });

  describe('isHeldBy', () => {
    it('should return true when token matches', async () => {
      // Given
      const key = 'test-lock';
      const token = 'my-token';
      mockDriver.get.mockResolvedValue(token);

      // When
      const result = await adapter.isHeldBy(key, token);

      // Then
      expect(result).toBe(true);
      expect(mockDriver.get).toHaveBeenCalledWith(key);
    });

    it('should return false when token does not match', async () => {
      // Given
      const key = 'test-lock';
      mockDriver.get.mockResolvedValue('other-token');

      // When
      const result = await adapter.isHeldBy(key, 'my-token');

      // Then
      expect(result).toBe(false);
    });

    it('should return false when lock does not exist', async () => {
      // Given
      mockDriver.get.mockResolvedValue(null);

      // When
      const result = await adapter.isHeldBy('key', 'token');

      // Then
      expect(result).toBe(false);
    });
  });

  describe('forceRelease', () => {
    it('should delete lock and return true', async () => {
      // Given
      mockDriver.del.mockResolvedValue(1);

      // When
      const result = await adapter.forceRelease('test-lock');

      // Then
      expect(result).toBe(true);
      expect(mockDriver.del).toHaveBeenCalledWith('test-lock');
    });

    it('should return false when lock does not exist', async () => {
      // Given
      mockDriver.del.mockResolvedValue(0);

      // When
      const result = await adapter.forceRelease('test-lock');

      // Then
      expect(result).toBe(false);
    });
  });
});
