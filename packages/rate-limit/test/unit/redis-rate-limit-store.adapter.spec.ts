import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';
import type { IRedisDriver } from '@nestjs-redisx/core';
import { RedisRateLimitStoreAdapter } from '../../src/rate-limit/infrastructure/adapters/redis-rate-limit-store.adapter';
import { RateLimitScriptError } from '../../src/shared/errors';

describe('RedisRateLimitStoreAdapter', () => {
  let adapter: RedisRateLimitStoreAdapter;
  let mockDriver: MockedObject<IRedisDriver>;

  beforeEach(() => {
    mockDriver = {
      scriptLoad: vi.fn(),
      evalsha: vi.fn(),
      eval: vi.fn(),
      get: vi.fn(),
      zcard: vi.fn(),
      del: vi.fn(),
    } as unknown as MockedObject<IRedisDriver>;

    adapter = new RedisRateLimitStoreAdapter(mockDriver);
  });

  describe('onModuleInit', () => {
    it('should load all Lua scripts on initialization', async () => {
      // Given
      mockDriver.scriptLoad.mockResolvedValueOnce('fixed-sha').mockResolvedValueOnce('sliding-sha').mockResolvedValueOnce('bucket-sha');

      // When
      await adapter.onModuleInit();

      // Then
      expect(mockDriver.scriptLoad).toHaveBeenCalledTimes(3);
      expect(mockDriver.scriptLoad).toHaveBeenCalledWith(expect.stringContaining('INCR'));
      expect(mockDriver.scriptLoad).toHaveBeenCalledWith(expect.stringContaining('ZREMRANGEBYSCORE'));
      expect(mockDriver.scriptLoad).toHaveBeenCalledWith(expect.stringContaining('HMGET'));
    });

    it('should throw RateLimitScriptError when script loading fails', async () => {
      // Given
      mockDriver.scriptLoad.mockRejectedValue(new Error('Redis connection failed'));

      // When/Then
      try {
        await adapter.onModuleInit();
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/RateLimitScriptError/);
        expect((error as Error).message).toContain('Failed to load Lua scripts');
      }
    });
  });

  describe('fixedWindow', () => {
    beforeEach(async () => {
      mockDriver.scriptLoad.mockResolvedValue('sha1');
      await adapter.onModuleInit();
    });

    it('should check fixed window rate limit successfully', async () => {
      // Given
      mockDriver.evalsha.mockResolvedValue([1, 99, 1706400000, 1]);

      // When
      const result = await adapter.fixedWindow('test-key', 100, 60);

      // Then
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(100);
      expect(result.remaining).toBe(99);
      expect(result.current).toBe(1);
      expect(mockDriver.evalsha).toHaveBeenCalled();
    });

    it('should return not allowed when limit exceeded', async () => {
      // Given
      const resetTime = Math.floor(Date.now() / 1000) + 60;
      mockDriver.evalsha.mockResolvedValue([0, 0, resetTime, 100]);

      // When
      const result = await adapter.fixedWindow('test-key', 100, 60);

      // Then
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it('should fallback to eval on NOSCRIPT error', async () => {
      // Given
      mockDriver.evalsha.mockRejectedValue(new Error('NOSCRIPT No matching script'));
      mockDriver.eval.mockResolvedValue([1, 99, 1706400000, 1]);

      // When
      const result = await adapter.fixedWindow('test-key', 100, 60);

      // Then
      expect(result.allowed).toBe(true);
      expect(mockDriver.eval).toHaveBeenCalled();
    });

    it('should throw RateLimitScriptError on non-NOSCRIPT error', async () => {
      // Given
      mockDriver.evalsha.mockRejectedValue(new Error('Connection timeout'));

      // When/Then
      try {
        await adapter.fixedWindow('test-key', 100, 60);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/RateLimitScriptError/);
        expect((error as Error).message).toContain('Fixed window check failed');
      }
    });
  });

  describe('slidingWindow', () => {
    beforeEach(async () => {
      mockDriver.scriptLoad.mockResolvedValue('sha1');
      await adapter.onModuleInit();
    });

    it('should check sliding window rate limit successfully', async () => {
      // Given
      mockDriver.evalsha.mockResolvedValue([1, 99, 1706400000, 1, undefined]);

      // When
      const result = await adapter.slidingWindow('test-key', 100, 60);

      // Then
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(100);
      expect(result.remaining).toBe(99);
      expect(result.current).toBe(1);
    });

    it('should include retryAfter when limit exceeded', async () => {
      // Given
      mockDriver.evalsha.mockResolvedValue([0, 0, 1706400000, 100, 30]);

      // When
      const result = await adapter.slidingWindow('test-key', 100, 60);

      // Then
      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBe(30);
    });

    it('should fallback to eval on NOSCRIPT error', async () => {
      // Given
      mockDriver.evalsha.mockRejectedValue(new Error('NOSCRIPT'));
      mockDriver.eval.mockResolvedValue([1, 99, 1706400000, 1]);

      // When
      const result = await adapter.slidingWindow('test-key', 100, 60);

      // Then
      expect(result.allowed).toBe(true);
      expect(mockDriver.eval).toHaveBeenCalled();
    });

    it('should throw RateLimitScriptError on error', async () => {
      // Given
      mockDriver.evalsha.mockRejectedValue(new Error('Error'));

      // When/Then
      try {
        await adapter.slidingWindow('test-key', 100, 60);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/RateLimitScriptError/);
      }
    });
  });

  describe('tokenBucket', () => {
    beforeEach(async () => {
      mockDriver.scriptLoad.mockResolvedValue('sha1');
      await adapter.onModuleInit();
    });

    it('should check token bucket rate limit successfully', async () => {
      // Given
      mockDriver.evalsha.mockResolvedValue([1, 149, 0, 150, undefined]);

      // When
      const result = await adapter.tokenBucket('test-key', 150, 5, 1);

      // Then
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(150);
      expect(result.remaining).toBe(149);
      expect(result.reset).toBe(0);
    });

    it('should include retryAfter when bucket empty', async () => {
      // Given
      mockDriver.evalsha.mockResolvedValue([0, 0, 0, 0, 10]);

      // When
      const result = await adapter.tokenBucket('test-key', 100, 10, 1);

      // Then
      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBe(10);
    });

    it('should fallback to eval on NOSCRIPT error', async () => {
      // Given
      mockDriver.evalsha.mockRejectedValue(new Error('No matching script'));
      mockDriver.eval.mockResolvedValue([1, 99, 0, 100]);

      // When
      const result = await adapter.tokenBucket('test-key', 100, 10, 1);

      // Then
      expect(result.allowed).toBe(true);
      expect(mockDriver.eval).toHaveBeenCalled();
    });

    it('should throw RateLimitScriptError on error', async () => {
      // Given
      mockDriver.evalsha.mockRejectedValue(new Error('Error'));

      // When/Then
      try {
        await adapter.tokenBucket('test-key', 100, 10, 1);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/RateLimitScriptError/);
      }
    });
  });

  describe('peek', () => {
    it('should peek fixed-window state', async () => {
      // Given
      mockDriver.get.mockResolvedValue('50');

      // When
      const result = await adapter.peek('test-key', 'fixed-window', {
        points: 100,
        duration: 60,
      });

      // Then
      expect(result.current).toBe(50);
      expect(result.limit).toBe(100);
      expect(result.remaining).toBe(50);
      expect(result.allowed).toBe(true);
    });

    it('should peek sliding-window state', async () => {
      // Given
      mockDriver.zcard.mockResolvedValue(25);

      // When
      const result = await adapter.peek('test-key', 'sliding-window', {
        points: 100,
        duration: 60,
      });

      // Then
      expect(result.current).toBe(25);
      expect(result.limit).toBe(100);
      expect(result.remaining).toBe(75);
      expect(result.allowed).toBe(true);
    });

    it('should peek token-bucket state', async () => {
      // Given/When
      const result = await adapter.peek('test-key', 'token-bucket', {
        capacity: 100,
      });

      // Then
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(100);
    });

    it('should throw RateLimitScriptError on peek error', async () => {
      // Given
      mockDriver.get.mockRejectedValue(new Error('Connection lost'));

      // When/Then
      try {
        await adapter.peek('test-key', 'fixed-window', { points: 100 });
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/RateLimitScriptError/);
        expect((error as Error).message).toContain('Peek failed');
      }
    });
  });

  describe('reset', () => {
    it('should reset rate limit key', async () => {
      // Given
      mockDriver.del.mockResolvedValue(1);

      // When
      await adapter.reset('test-key');

      // Then
      expect(mockDriver.del).toHaveBeenCalledWith('test-key');
    });

    it('should throw RateLimitScriptError on reset error', async () => {
      // Given
      mockDriver.del.mockRejectedValue(new Error('Error'));

      // When/Then
      try {
        await adapter.reset('test-key');
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/RateLimitScriptError/);
        expect((error as Error).message).toContain('Reset failed');
      }
    });
  });
});
