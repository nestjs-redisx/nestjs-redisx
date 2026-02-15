import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';
import { LockService } from '../../src/lock/application/services/lock.service';
import type { ILockStore } from '../../src/lock/application/ports/lock-store.port';
import type { ILocksPluginOptions } from '../../src/shared/types';
import { LockAcquisitionError } from '../../src/shared/errors';
import { Lock } from '../../src/lock/domain/entities/lock.entity';

describe('LockService', () => {
  let service: LockService;
  let mockStore: MockedObject<ILockStore>;
  let config: ILocksPluginOptions;

  beforeEach(() => {
    mockStore = {
      acquire: vi.fn(),
      release: vi.fn(),
      extend: vi.fn(),
      isHeldBy: vi.fn(),
      exists: vi.fn(),
      forceRelease: vi.fn(),
    } as unknown as MockedObject<ILockStore>;

    config = {
      keyPrefix: '_lock:',
      defaultTtl: 30000,
      maxTtl: 300000,
      autoRenew: {
        enabled: true,
        intervalFraction: 0.5,
      },
      retry: {
        maxRetries: 3,
        initialDelay: 100,
        maxDelay: 3000,
        multiplier: 2,
      },
    };

    service = new LockService(config, mockStore);
  });

  describe('acquire', () => {
    it('should acquire lock successfully on first attempt', async () => {
      // Given
      const key = 'test-key';
      mockStore.acquire.mockResolvedValue(true);

      // When
      const lock = await service.acquire(key);

      // Then
      expect(lock).toBeInstanceOf(Lock);
      expect(lock.key).toBe('_lock:test-key');
      expect(mockStore.acquire).toHaveBeenCalledWith('_lock:test-key', expect.any(String), 30000);
    });

    it('should retry on failure and eventually succeed', async () => {
      // Given
      const key = 'test-key';
      mockStore.acquire.mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

      // When
      const lock = await service.acquire(key);

      // Then
      expect(lock).toBeInstanceOf(Lock);
      expect(mockStore.acquire).toHaveBeenCalledTimes(3);
    });

    it('should throw LockAcquisitionError after max retries', async () => {
      // Given
      const key = 'test-key';
      mockStore.acquire.mockResolvedValue(false);

      // When/Then
      try {
        await service.acquire(key);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/LockAcquisitionError/);
        expect((error as LockAcquisitionError).reason).toBe('timeout');
      }

      expect(mockStore.acquire).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    });

    it('should use custom TTL from options', async () => {
      // Given
      const key = 'test-key';
      const ttl = 60000;
      mockStore.acquire.mockResolvedValue(true);

      // When
      await service.acquire(key, { ttl });

      // Then
      expect(mockStore.acquire).toHaveBeenCalledWith('_lock:test-key', expect.any(String), ttl);
    });

    it('should enforce max TTL limit', async () => {
      // Given
      const key = 'test-key';
      const ttl = 500000; // Greater than maxTtl
      mockStore.acquire.mockResolvedValue(true);

      // When
      await service.acquire(key, { ttl });

      // Then
      expect(mockStore.acquire).toHaveBeenCalledWith(
        '_lock:test-key',
        expect.any(String),
        300000, // Should be capped to maxTtl
      );
    });

    it('should use custom retry configuration', async () => {
      // Given
      const key = 'test-key';
      mockStore.acquire.mockResolvedValue(false);

      // When/Then
      try {
        await service.acquire(key, {
          retry: { maxRetries: 1, initialDelay: 10 },
        });
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/LockAcquisitionError/);
      }

      expect(mockStore.acquire).toHaveBeenCalledTimes(2); // 1 initial + 1 retry
    });

    it('should start auto-renewal when enabled', async () => {
      // Given
      const key = 'test-key';
      mockStore.acquire.mockResolvedValue(true);
      mockStore.extend.mockResolvedValue(true);

      // When
      const lock = await service.acquire(key);

      // Then
      expect((lock as Lock).isAutoRenewing).toBe(true);
    });

    it('should not start auto-renewal when disabled', async () => {
      // Given
      const key = 'test-key';
      mockStore.acquire.mockResolvedValue(true);

      // When
      const lock = await service.acquire(key, { autoRenew: false });

      // Then
      expect((lock as Lock).isAutoRenewing).toBe(false);
    });
  });

  describe('tryAcquire', () => {
    it('should acquire lock without retry', async () => {
      // Given
      const key = 'test-key';
      mockStore.acquire.mockResolvedValue(true);

      // When
      const lock = await service.tryAcquire(key);

      // Then
      expect(lock).toBeInstanceOf(Lock);
      expect(mockStore.acquire).toHaveBeenCalledTimes(1);
    });

    it('should return null immediately on failure', async () => {
      // Given
      const key = 'test-key';
      mockStore.acquire.mockResolvedValue(false);

      // When
      const lock = await service.tryAcquire(key);

      // Then
      expect(lock).toBeNull();
      expect(mockStore.acquire).toHaveBeenCalledTimes(1);
    });

    it('should use custom TTL', async () => {
      // Given
      const key = 'test-key';
      const ttl = 60000;
      mockStore.acquire.mockResolvedValue(true);

      // When
      await service.tryAcquire(key, { ttl });

      // Then
      expect(mockStore.acquire).toHaveBeenCalledWith('_lock:test-key', expect.any(String), ttl);
    });
  });

  describe('withLock', () => {
    it('should execute function with lock', async () => {
      // Given
      const key = 'test-key';
      const fn = vi.fn().mockResolvedValue('result');
      mockStore.acquire.mockResolvedValue(true);
      mockStore.release.mockResolvedValue(true);

      // When
      const result = await service.withLock(key, fn);

      // Then
      expect(result).toBe('result');
      expect(fn).toHaveBeenCalled();
      expect(mockStore.acquire).toHaveBeenCalled();
      expect(mockStore.release).toHaveBeenCalled();
    });

    it('should release lock even if function throws', async () => {
      // Given
      const key = 'test-key';
      const error = new Error('Function error');
      const fn = vi.fn().mockRejectedValue(error);
      mockStore.acquire.mockResolvedValue(true);
      mockStore.release.mockResolvedValue(true);

      // When/Then
      try {
        await service.withLock(key, fn);
        expect.fail('Should have thrown error');
      } catch (e) {
        expect(e).toBe(error);
      }

      expect(mockStore.release).toHaveBeenCalled();
    });

    it('should handle lock release errors gracefully', async () => {
      // Given
      const key = 'test-key';
      const fn = vi.fn().mockResolvedValue('result');
      mockStore.acquire.mockResolvedValue(true);
      mockStore.release.mockRejectedValue(new Error('Release error'));

      // When
      const result = await service.withLock(key, fn);

      // Then
      expect(result).toBe('result');
    });

    it('should throw if lock acquisition fails', async () => {
      // Given
      const key = 'test-key';
      const fn = vi.fn();
      mockStore.acquire.mockResolvedValue(false);

      // When/Then
      try {
        await service.withLock(key, fn);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/LockAcquisitionError/);
      }

      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('isLocked', () => {
    it('should return true when lock exists', async () => {
      // Given
      const key = 'test-key';
      mockStore.exists.mockResolvedValue(true);

      // When
      const result = await service.isLocked(key);

      // Then
      expect(result).toBe(true);
      expect(mockStore.exists).toHaveBeenCalledWith('_lock:test-key');
    });

    it('should return false when lock does not exist', async () => {
      // Given
      const key = 'test-key';
      mockStore.exists.mockResolvedValue(false);

      // When
      const result = await service.isLocked(key);

      // Then
      expect(result).toBe(false);
    });
  });

  describe('forceRelease', () => {
    it('should force release lock', async () => {
      // Given
      const key = 'test-key';
      mockStore.forceRelease.mockResolvedValue(true);

      // When
      const result = await service.forceRelease(key);

      // Then
      expect(result).toBe(true);
      expect(mockStore.forceRelease).toHaveBeenCalledWith('_lock:test-key');
    });

    it('should return false when lock does not exist', async () => {
      // Given
      const key = 'test-key';
      mockStore.forceRelease.mockResolvedValue(false);

      // When
      const result = await service.forceRelease(key);

      // Then
      expect(result).toBe(false);
    });
  });

  describe('onModuleDestroy', () => {
    it('should release all active locks on shutdown', async () => {
      // Given
      mockStore.acquire.mockResolvedValue(true);
      mockStore.release.mockResolvedValue(true);

      await service.acquire('key1');
      await service.acquire('key2');
      await service.acquire('key3');

      // When
      await service.onModuleDestroy();

      // Then
      expect(mockStore.release).toHaveBeenCalledTimes(3);
    });

    it('should continue shutdown even if release fails', async () => {
      // Given
      mockStore.acquire.mockResolvedValue(true);
      mockStore.release.mockRejectedValueOnce(new Error('Release error 1')).mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('Release error 2'));

      await service.acquire('key1');
      await service.acquire('key2');
      await service.acquire('key3');

      // When
      await service.onModuleDestroy();

      // Then
      expect(mockStore.release).toHaveBeenCalledTimes(3);
    });

    it('should clear active locks after shutdown', async () => {
      // Given
      mockStore.acquire.mockResolvedValue(true);
      mockStore.release.mockResolvedValue(true);

      await service.acquire('key1');

      // When
      await service.onModuleDestroy();

      // Then - should be able to shut down again without errors
      await service.onModuleDestroy();
    });
  });

  describe('configuration', () => {
    it('should use default key prefix when not configured', async () => {
      // Given
      const serviceWithDefaults = new LockService({}, mockStore);
      mockStore.acquire.mockResolvedValue(true);

      // When
      await serviceWithDefaults.acquire('test-key');

      // Then
      expect(mockStore.acquire).toHaveBeenCalledWith('_lock:test-key', expect.any(String), expect.any(Number));
    });

    it('should use custom key prefix', async () => {
      // Given
      const customService = new LockService({ keyPrefix: 'custom:' }, mockStore);
      mockStore.acquire.mockResolvedValue(true);

      // When
      await customService.acquire('test-key');

      // Then
      expect(mockStore.acquire).toHaveBeenCalledWith('custom:test-key', expect.any(String), expect.any(Number));
    });

    it('should use default TTL when not configured', async () => {
      // Given
      const serviceWithDefaults = new LockService({}, mockStore);
      mockStore.acquire.mockResolvedValue(true);

      // When
      await serviceWithDefaults.acquire('test-key');

      // Then
      expect(mockStore.acquire).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        30000, // default TTL
      );
    });
  });

  describe('retry behavior', () => {
    it('should use exponential backoff', async () => {
      // Given
      const key = 'test-key';
      mockStore.acquire.mockResolvedValue(false);
      const sleepSpy = vi.spyOn(service as any, 'sleep');

      // When/Then
      try {
        await service.acquire(key);
      } catch {
        // Expected to fail
      }

      // Then - should have delays: 100, 200, 400
      expect(sleepSpy).toHaveBeenCalledTimes(3);
      expect(sleepSpy).toHaveBeenNthCalledWith(1, 100);
      expect(sleepSpy).toHaveBeenNthCalledWith(2, 200);
      expect(sleepSpy).toHaveBeenNthCalledWith(3, 400);
    });

    it('should cap delay at maxDelay', async () => {
      // Given
      const key = 'test-key';
      const customConfig = {
        ...config,
        retry: {
          maxRetries: 5,
          initialDelay: 100,
          maxDelay: 200,
          multiplier: 2,
        },
      };
      const customService = new LockService(customConfig, mockStore);
      mockStore.acquire.mockResolvedValue(false);
      const sleepSpy = vi.spyOn(customService as any, 'sleep');

      // When/Then
      try {
        await customService.acquire(key);
      } catch {
        // Expected to fail
      }

      // Then - delays should be: 100, 200, 200, 200, 200 (capped at maxDelay)
      expect(sleepSpy).toHaveBeenCalledWith(100);
      expect(sleepSpy).toHaveBeenCalledWith(200);
    });
  });
});
