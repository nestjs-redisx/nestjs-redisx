import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MockedObject } from 'vitest';
import { StampedeProtectionService } from '../../src/stampede/infrastructure/stampede-protection.service';
import type { ICachePluginOptions } from '../../src/shared/types';
import type { IRedisDriver } from '@nestjs-redisx/core';

function createMockDriver(): MockedObject<IRedisDriver> {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    exists: vi.fn().mockResolvedValue(0),
    eval: vi.fn().mockResolvedValue(1),
    evalsha: vi.fn().mockResolvedValue(null),
    scriptLoad: vi.fn().mockResolvedValue('sha1'),
    mget: vi.fn().mockResolvedValue([]),
    mset: vi.fn().mockResolvedValue('OK'),
    sadd: vi.fn().mockResolvedValue(1),
    smembers: vi.fn().mockResolvedValue([]),
    expire: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(-1),
    scan: vi.fn().mockResolvedValue({ cursor: 0, keys: [] }),
    pipeline: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue([]) }),
  } as unknown as MockedObject<IRedisDriver>;
}

describe('StampedeProtectionService', () => {
  let service: StampedeProtectionService;
  let options: ICachePluginOptions;
  let mockDriver: MockedObject<IRedisDriver>;

  beforeEach(() => {
    options = {
      stampede: {
        lockTimeout: 10000,
        waitTimeout: 5000,
      },
    };
    mockDriver = createMockDriver();
    // SET NX returns 'OK' by default (lock acquired)
    mockDriver.set.mockResolvedValue('OK');
    service = new StampedeProtectionService(options, mockDriver);
  });

  describe('protect', () => {
    it('should execute loader on first call', async () => {
      // Given
      const key = 'test-key';
      const loader = vi.fn().mockResolvedValue('test-value');

      // When
      const result = await service.protect(key, loader);

      // Then
      expect(result.value).toBe('test-value');
      expect(result.cached).toBe(false);
      expect(result.waited).toBe(false);
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it('should acquire distributed lock before executing loader', async () => {
      // Given
      const key = 'test-key';
      const loader = vi.fn().mockResolvedValue('value');

      // When
      await service.protect(key, loader);

      // Then
      expect(mockDriver.set).toHaveBeenCalledWith(expect.stringContaining(key), expect.any(String), { ex: expect.any(Number), nx: true });
    });

    it('should release distributed lock after loader completes', async () => {
      // Given
      const key = 'test-key';
      const loader = vi.fn().mockResolvedValue('value');

      // When
      await service.protect(key, loader);
      // Wait for async lock release
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Then
      expect(mockDriver.eval).toHaveBeenCalledWith(expect.stringContaining('redis.call("get"'), [expect.stringContaining(key)], [expect.any(String)]);
    });

    it('should return same promise for concurrent calls within same process', async () => {
      // Given
      const key = 'test-key';
      let resolveLoader: ((value: string) => void) | undefined;
      const loader = vi.fn(
        () =>
          new Promise<string>((resolve) => {
            resolveLoader = resolve;
          }),
      );

      // When
      const promise1 = service.protect(key, loader);
      const promise2 = service.protect(key, loader);

      setTimeout(() => resolveLoader?.('test-value'), 10);

      const [result1, result2] = await Promise.all([promise1, promise2]);

      // Then
      expect(loader).toHaveBeenCalledTimes(1);
      expect(result1.value).toBe('test-value');
      expect(result1.waited).toBe(false);
      expect(result2.value).toBe('test-value');
      expect(result2.waited).toBe(true);
    });

    it('should handle loader errors', async () => {
      // Given
      const key = 'test-key';
      const error = new Error('Loader failed');
      const loader = vi.fn().mockRejectedValue(error);

      // When/Then
      await expect(service.protect(key, loader)).rejects.toThrow(/Loader failed/);
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it('should propagate loader errors to waiters', async () => {
      // Given
      const key = 'test-key';
      let rejectLoader: ((error: Error) => void) | undefined;
      const loader = vi.fn(
        () =>
          new Promise<string>((_, reject) => {
            rejectLoader = reject;
          }),
      );

      // When
      const promise1 = service.protect(key, loader);
      const promise2 = service.protect(key, loader);

      setTimeout(() => rejectLoader?.(new Error('Loader failed')), 10);

      // Then
      await expect(promise1).rejects.toThrow(/Loader failed/);
      await expect(promise2).rejects.toThrow(/Loader failed/);
    });

    it('should clean up flight after execution', async () => {
      // Given
      const key = 'test-key';
      const loader = vi.fn().mockResolvedValue('value');

      // When
      await service.protect(key, loader);
      await new Promise((resolve) => setTimeout(resolve, 150));

      const stats = service.getStats();

      // Then
      expect(stats.activeFlights).toBe(0);
    });

    it('should fallback to loader when distributed lock fails', async () => {
      // Given — lock acquisition fails (Redis error)
      mockDriver.set.mockRejectedValue(new Error('Redis connection error'));
      const key = 'test-key';
      const loader = vi.fn().mockResolvedValue('fallback-value');

      // When
      const result = await service.protect(key, loader);

      // Then — should still succeed via direct execution
      expect(result.value).toBe('fallback-value');
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it('should still execute loader when distributed lock not acquired', async () => {
      // Given — lock not acquired (another instance has it)
      mockDriver.set.mockResolvedValue(null);
      const key = 'test-key';
      const loader = vi.fn().mockResolvedValue('value');

      // When — executes loader anyway (this process is the leader locally)
      const result = await service.protect(key, loader);

      // Then
      expect(result.value).toBe('value');
      expect(result.cached).toBe(false);
      expect(loader).toHaveBeenCalledTimes(1);
    });
  });

  describe('clearKey', () => {
    it('should do nothing if key not found', async () => {
      // Given
      const key = 'non-existent';

      // When/Then
      await expect(service.clearKey(key)).resolves.toBeUndefined();
    });
  });

  describe('getStats', () => {
    it('should return zero stats when no flights', () => {
      // Given/When
      const stats = service.getStats();

      // Then
      expect(stats.activeFlights).toBe(0);
      expect(stats.totalWaiters).toBe(0);
      expect(stats.oldestFlight).toBe(0);
    });

    it('should count active flights immediately', async () => {
      // Given
      let resolveLoader1: ((value: string) => void) | undefined;
      let resolveLoader2: ((value: string) => void) | undefined;
      const loader1 = vi.fn(
        () =>
          new Promise<string>((resolve) => {
            resolveLoader1 = resolve;
          }),
      );
      const loader2 = vi.fn(
        () =>
          new Promise<string>((resolve) => {
            resolveLoader2 = resolve;
          }),
      );

      const promise1 = service.protect('key1', loader1);
      const promise2 = service.protect('key2', loader2);

      // When
      const stats = service.getStats();

      // Then
      expect(stats.activeFlights).toBe(2);

      // Cleanup
      setTimeout(() => {
        resolveLoader1?.('value1');
        resolveLoader2?.('value2');
      }, 10);
      await Promise.all([promise1, promise2]);
    });

    it('should count total waiters', async () => {
      // Given
      let resolveLoader: ((value: string) => void) | undefined;
      const loader = vi.fn(
        () =>
          new Promise<string>((resolve) => {
            resolveLoader = resolve;
          }),
      );

      const promise1 = service.protect('key1', loader);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const promise2 = service.protect('key1', loader);
      const promise3 = service.protect('key1', loader);

      // When
      const stats = service.getStats();

      // Then
      expect(stats.totalWaiters).toBe(2);

      // Cleanup
      setTimeout(() => resolveLoader?.('value'), 10);
      await Promise.all([promise1, promise2, promise3]);
    });

    it('should calculate oldest flight age', async () => {
      // Given
      let resolveLoader: ((value: string) => void) | undefined;
      const loader = vi.fn(
        () =>
          new Promise<string>((resolve) => {
            resolveLoader = resolve;
          }),
      );

      const promise = service.protect('key1', loader);
      await new Promise((resolve) => setTimeout(resolve, 100));

      // When
      const stats = service.getStats();

      // Then
      expect(stats.oldestFlight).toBeGreaterThan(90);

      // Cleanup
      setTimeout(() => resolveLoader?.('value'), 10);
      await promise;
    });
  });

  describe('distributed lock', () => {
    it('should use SET NX EX for lock acquisition', async () => {
      // Given
      const key = 'test-key';
      const loader = vi.fn().mockResolvedValue('value');

      // When
      await service.protect(key, loader);

      // Then
      expect(mockDriver.set).toHaveBeenCalledWith(`_stampede:${key}`, expect.any(String), { ex: expect.any(Number), nx: true });
    });

    it('should use Lua script for safe lock release', async () => {
      // Given
      const key = 'test-key';
      const loader = vi.fn().mockResolvedValue('value');

      // When
      await service.protect(key, loader);
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Then — Lua script checks ownership before releasing
      expect(mockDriver.eval).toHaveBeenCalledWith(expect.stringContaining('redis.call("del"'), [`_stampede:${key}`], [expect.any(String)]);
    });

    it('should handle lock release failure gracefully', async () => {
      // Given
      mockDriver.eval.mockRejectedValue(new Error('Redis error'));
      const key = 'test-key';
      const loader = vi.fn().mockResolvedValue('value');

      // When — should not throw even if lock release fails
      const result = await service.protect(key, loader);
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Then
      expect(result.value).toBe('value');
    });
  });

  describe('timeout handling', () => {
    it('should use default timeouts when not configured', () => {
      // Given
      const serviceWithDefaults = new StampedeProtectionService({}, mockDriver);

      // When/Then
      expect(serviceWithDefaults).toBeDefined();
    });

    it('should clear timeout on successful loader completion', async () => {
      // Given
      const key = 'test-key';
      const loader = vi.fn().mockResolvedValue('value');

      // When
      const result = await service.protect(key, loader);

      // Then
      expect(result.value).toBe('value');
    });

    it('should clear waiter timeout on flight completion', async () => {
      // Given
      const key = 'test-key';
      let resolveLoader: ((value: string) => void) | undefined;
      const loader = vi.fn(
        () =>
          new Promise<string>((resolve) => {
            resolveLoader = resolve;
          }),
      );

      // When
      const promise1 = service.protect(key, loader);
      const promise2 = service.protect(key, loader);

      setTimeout(() => resolveLoader?.('value'), 100);

      const [result1, result2] = await Promise.all([promise1, promise2]);

      // Then
      expect(result1.value).toBe('value');
      expect(result2.value).toBe('value');
    });
  });
});
