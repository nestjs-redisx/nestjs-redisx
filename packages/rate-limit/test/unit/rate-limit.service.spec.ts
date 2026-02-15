import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';
import { RateLimitService } from '../../src/rate-limit/application/services/rate-limit.service';
import type { IRateLimitStore } from '../../src/rate-limit/application/ports/rate-limit-store.port';
import type { IRateLimitPluginOptions, RateLimitConfig, RateLimitResult } from '../../src/shared/types';
import { RateLimitScriptError } from '../../src/shared/errors';

describe('RateLimitService', () => {
  let service: RateLimitService;
  let mockStore: MockedObject<IRateLimitStore>;
  let config: IRateLimitPluginOptions;

  const defaultResult: IRateLimitResult = {
    allowed: true,
    limit: 100,
    remaining: 99,
    reset: Math.floor(Date.now() / 1000) + 60,
    current: 1,
  };

  beforeEach(() => {
    mockStore = {
      fixedWindow: vi.fn().mockResolvedValue(defaultResult),
      slidingWindow: vi.fn().mockResolvedValue(defaultResult),
      tokenBucket: vi.fn().mockResolvedValue(defaultResult),
      peek: vi.fn().mockResolvedValue(defaultResult),
      reset: vi.fn().mockResolvedValue(undefined),
    } as unknown as MockedObject<IRateLimitStore>;

    config = {
      keyPrefix: 'rl:',
      defaultPoints: 100,
      defaultDuration: 60,
      defaultAlgorithm: 'sliding-window',
      errorPolicy: 'fail-closed',
    };

    service = new RateLimitService(config, mockStore);
  });

  describe('check', () => {
    it('should check rate limit with default algorithm', async () => {
      // Given
      const key = 'user:123';

      // When
      const result = await service.check(key);

      // Then
      expect(result).toEqual(defaultResult);
      // Key includes algorithm prefix to avoid WRONGTYPE errors
      expect(mockStore.slidingWindow).toHaveBeenCalledWith('rl:sliding-window:user:123', 100, 60);
    });

    it('should check with fixed-window algorithm', async () => {
      // Given
      const key = 'api:endpoint';
      const rateLimitConfig: IRateLimitConfig = {
        algorithm: 'fixed-window',
        points: 50,
        duration: 30,
      };

      // When
      await service.check(key, rateLimitConfig);

      // Then
      expect(mockStore.fixedWindow).toHaveBeenCalledWith('rl:fixed-window:api:endpoint', 50, 30);
    });

    it('should check with sliding-window algorithm', async () => {
      // Given
      const key = 'user:456';
      const rateLimitConfig: IRateLimitConfig = {
        algorithm: 'sliding-window',
        points: 200,
        duration: 120,
      };

      // When
      await service.check(key, rateLimitConfig);

      // Then
      expect(mockStore.slidingWindow).toHaveBeenCalledWith('rl:sliding-window:user:456', 200, 120);
    });

    it('should check with token-bucket algorithm', async () => {
      // Given
      const key = 'resource:abc';
      const rateLimitConfig: IRateLimitConfig = {
        algorithm: 'token-bucket',
        capacity: 150,
        refillRate: 5,
      };

      // When
      await service.check(key, rateLimitConfig);

      // Then
      expect(mockStore.tokenBucket).toHaveBeenCalledWith('rl:token-bucket:resource:abc', 150, 5, 1);
    });

    it('should use default capacity and refillRate for token-bucket', async () => {
      // Given
      const key = 'resource:default';
      const rateLimitConfig: IRateLimitConfig = {
        algorithm: 'token-bucket',
        points: 120,
        duration: 60,
      };

      // When
      await service.check(key, rateLimitConfig);

      // Then
      // capacity defaults to points (120), refillRate defaults to capacity/duration (120/60 = 2)
      expect(mockStore.tokenBucket).toHaveBeenCalledWith('rl:token-bucket:resource:default', 120, 2, 1);
    });

    it('should use default points and duration', async () => {
      // Given
      const key = 'test';

      // When
      await service.check(key, { algorithm: 'fixed-window' });

      // Then
      expect(mockStore.fixedWindow).toHaveBeenCalledWith('rl:fixed-window:test', 100, 60);
    });

    it('should throw error for unknown algorithm', async () => {
      // Given
      const key = 'test';
      const rateLimitConfig: IRateLimitConfig = {
        algorithm: 'unknown' as any,
      };

      // When/Then
      await expect(service.check(key, rateLimitConfig)).rejects.toThrow('Unknown algorithm');
    });

    it('should handle error with fail-closed policy', async () => {
      // Given
      const key = 'test';
      mockStore.slidingWindow.mockRejectedValue(new Error('Redis error'));

      // When/Then
      try {
        await service.check(key);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/RateLimitScriptError/);
      }
    });

    it('should handle error with fail-open policy', async () => {
      // Given
      const key = 'test';
      const serviceWithFailOpen = new RateLimitService({ ...config, errorPolicy: 'fail-open' }, mockStore);
      mockStore.slidingWindow.mockRejectedValue(new Error('Redis error'));

      // When
      const result = await serviceWithFailOpen.check(key);

      // Then
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(100);
      expect(result.remaining).toBe(100);
    });

    it('should handle error with fail-open and minimal config', async () => {
      // Given
      const key = 'test';
      const serviceWithFailOpen = new RateLimitService(
        { errorPolicy: 'fail-open' }, // No defaultPoints or defaultDuration
        mockStore,
      );
      mockStore.slidingWindow.mockRejectedValue(new Error('Redis error'));

      // When
      const result = await serviceWithFailOpen.check(key, {}); // Empty config

      // Then - should use hardcoded defaults (100 points, 60 duration)
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(100);
      expect(result.remaining).toBe(100);
    });
  });

  describe('peek', () => {
    it('should peek without consuming', async () => {
      // Given
      const key = 'user:123';

      // When
      const result = await service.peek(key);

      // Then
      expect(result).toEqual(defaultResult);
      // Key includes algorithm prefix
      expect(mockStore.peek).toHaveBeenCalledWith('rl:sliding-window:user:123', 'sliding-window', {
        points: 100,
        duration: 60,
      });
    });

    it('should peek with custom algorithm', async () => {
      // Given
      const key = 'api:test';
      const rateLimitConfig: IRateLimitConfig = {
        algorithm: 'fixed-window',
        points: 50,
        duration: 30,
      };

      // When
      await service.peek(key, rateLimitConfig);

      // Then
      expect(mockStore.peek).toHaveBeenCalledWith('rl:fixed-window:api:test', 'fixed-window', {
        points: 50,
        duration: 30,
      });
    });

    it('should peek with token-bucket config', async () => {
      // Given
      const key = 'bucket:test';
      const rateLimitConfig: IRateLimitConfig = {
        algorithm: 'token-bucket',
        capacity: 100,
        refillRate: 10,
      };

      // When
      await service.peek(key, rateLimitConfig);

      // Then
      expect(mockStore.peek).toHaveBeenCalledWith('rl:token-bucket:bucket:test', 'token-bucket', {
        capacity: 100,
        refillRate: 10,
      });
    });

    it('should handle peek error with fail-closed', async () => {
      // Given
      const key = 'test';
      mockStore.peek.mockRejectedValue(new Error('Redis error'));

      // When/Then
      try {
        await service.peek(key);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/RateLimitScriptError/);
      }
    });

    it('should handle peek error with fail-open', async () => {
      // Given
      const key = 'test';
      const serviceWithFailOpen = new RateLimitService({ ...config, errorPolicy: 'fail-open' }, mockStore);
      mockStore.peek.mockRejectedValue(new Error('Redis error'));

      // When
      const result = await serviceWithFailOpen.peek(key);

      // Then
      expect(result.allowed).toBe(true);
    });
  });

  describe('reset', () => {
    it('should reset all algorithm variants', async () => {
      // Given
      const key = 'user:123';

      // When
      await service.reset(key);

      // Then - should reset all 3 algorithm variants
      expect(mockStore.reset).toHaveBeenCalledTimes(3);
      expect(mockStore.reset).toHaveBeenCalledWith('rl:fixed-window:user:123');
      expect(mockStore.reset).toHaveBeenCalledWith('rl:sliding-window:user:123');
      expect(mockStore.reset).toHaveBeenCalledWith('rl:token-bucket:user:123');
    });

    it('should build full key with prefix for all algorithms', async () => {
      // Given
      const key = 'api:endpoint';
      mockStore.reset.mockClear();

      // When
      await service.reset(key);

      // Then
      expect(mockStore.reset).toHaveBeenCalledTimes(3);
      expect(mockStore.reset).toHaveBeenCalledWith('rl:fixed-window:api:endpoint');
      expect(mockStore.reset).toHaveBeenCalledWith('rl:sliding-window:api:endpoint');
      expect(mockStore.reset).toHaveBeenCalledWith('rl:token-bucket:api:endpoint');
    });
  });

  describe('getState', () => {
    it('should get current state', async () => {
      // Given
      const key = 'user:123';
      const resetTime = Math.floor(Date.now() / 1000) + 60;
      mockStore.peek.mockResolvedValue({
        allowed: true,
        limit: 100,
        remaining: 75,
        reset: resetTime,
        current: 25,
      });

      // When
      const state = await service.getState(key);

      // Then
      expect(state.current).toBe(25);
      expect(state.limit).toBe(100);
      expect(state.remaining).toBe(75);
      expect(state.resetAt).toBeInstanceOf(Date);
      expect(state.resetAt.getTime()).toBe(resetTime * 1000);
    });

    it('should get state with custom config', async () => {
      // Given
      const key = 'api:test';
      const rateLimitConfig: IRateLimitConfig = {
        algorithm: 'fixed-window',
        points: 50,
      };

      // When
      await service.getState(key, rateLimitConfig);

      // Then
      expect(mockStore.peek).toHaveBeenCalledWith('rl:fixed-window:api:test', 'fixed-window', expect.any(Object));
    });
  });

  describe('key building', () => {
    it('should use configured key prefix', async () => {
      // Given
      const key = 'user:123';

      // When
      await service.check(key);

      // Then
      // Key includes algorithm prefix to avoid WRONGTYPE errors
      expect(mockStore.slidingWindow).toHaveBeenCalledWith('rl:sliding-window:user:123', expect.any(Number), expect.any(Number));
    });

    it('should use default prefix when not configured', async () => {
      // Given
      const serviceWithDefaults = new RateLimitService({}, mockStore);
      const key = 'test';

      // When
      await serviceWithDefaults.check(key);

      // Then
      // Key includes algorithm prefix
      expect(mockStore.slidingWindow).toHaveBeenCalledWith('rl:sliding-window:test', expect.any(Number), expect.any(Number));
    });
  });

  describe('token bucket calculations', () => {
    it('should calculate refill rate from duration', async () => {
      // Given
      const key = 'bucket:test';
      const rateLimitConfig: IRateLimitConfig = {
        algorithm: 'token-bucket',
        points: 60,
        duration: 60,
      };

      // When
      await service.check(key, rateLimitConfig);

      // Then
      expect(mockStore.tokenBucket).toHaveBeenCalledWith('rl:token-bucket:bucket:test', 60, 1, 1);
    });

    it('should use capacity over points for token bucket', async () => {
      // Given
      const key = 'bucket:test';
      const rateLimitConfig: IRateLimitConfig = {
        algorithm: 'token-bucket',
        points: 100,
        capacity: 150,
        refillRate: 5,
      };

      // When
      await service.check(key, rateLimitConfig);

      // Then
      expect(mockStore.tokenBucket).toHaveBeenCalledWith('rl:token-bucket:bucket:test', 150, 5, 1);
    });

    it('should use default refill rate when not specified', async () => {
      // Given
      const key = 'bucket:test';
      const rateLimitConfig: IRateLimitConfig = {
        algorithm: 'token-bucket',
        points: 100,
      };

      // When
      await service.check(key, rateLimitConfig);

      // Then
      // Default refill rate should be calculated: 100 / 60 ≈ 1.67
      expect(mockStore.tokenBucket).toHaveBeenCalledWith('rl:token-bucket:bucket:test', 100, expect.any(Number), 1);
    });
  });

  describe('error handling', () => {
    it('should throw RateLimitScriptError with fail-closed policy', async () => {
      // Given
      const key = 'test';
      const originalError = new Error('Redis connection failed');
      mockStore.slidingWindow.mockRejectedValue(originalError);

      // When/Then
      try {
        await service.check(key);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/RateLimitScriptError/);
        expect((error as RateLimitScriptError).cause).toBe(originalError);
      }
    });

    it('should allow request with fail-open policy', async () => {
      // Given
      const serviceWithFailOpen = new RateLimitService({ ...config, errorPolicy: 'fail-open', defaultPoints: 50, defaultDuration: 30 }, mockStore);
      mockStore.slidingWindow.mockRejectedValue(new Error('Error'));

      // When
      const result = await serviceWithFailOpen.check('test');

      // Then
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(50);
      expect(result.remaining).toBe(50);
      expect(result.current).toBe(0);
    });
  });

  describe('configuration defaults', () => {
    it('should use default algorithm when not specified', async () => {
      // Given
      const key = 'test';

      // When
      await service.check(key);

      // Then
      expect(mockStore.slidingWindow).toHaveBeenCalled();
    });

    it('should fallback to hardcoded defaults when config is empty', async () => {
      // Given
      const serviceWithEmptyConfig = new RateLimitService({}, mockStore);

      // When
      await serviceWithEmptyConfig.check('test');

      // Then
      // Key includes algorithm prefix
      expect(mockStore.slidingWindow).toHaveBeenCalledWith('rl:sliding-window:test', 100, 60);
    });
  });
});
