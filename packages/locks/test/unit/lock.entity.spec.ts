import { describe, it, expect, beforeEach, vi, afterEach, type MockedObject } from 'vitest';
import { Lock } from '../../src/lock/domain/entities/lock.entity';
import type { ILockStore } from '../../src/lock/application/ports/lock-store.port';
import { LockNotOwnedError, LockExtensionError } from '../../src/shared/errors';

describe('Lock Entity', () => {
  let lock: Lock;
  let mockStore: MockedObject<ILockStore>;
  const key = 'test-lock';
  const token = 'unique-token-123';
  const ttl = 30000;

  beforeEach(() => {
    mockStore = {
      acquire: vi.fn(),
      release: vi.fn(),
      extend: vi.fn(),
      isHeldBy: vi.fn(),
    } as unknown as MockedObject<ILockStore>;

    lock = new Lock(key, token, ttl, mockStore);
  });

  afterEach(() => {
    lock.stopAutoRenew();
  });

  describe('constructor', () => {
    it('should create lock with provided parameters', () => {
      // Given/When
      const lock = new Lock(key, token, ttl, mockStore);

      // Then
      expect(lock.key).toBe(key);
      expect(lock.token).toBe(token);
      expect(lock.ttl).toBe(ttl);
      expect(lock.acquiredAt).toBeInstanceOf(Date);
      expect(lock.expiresAt).toBeInstanceOf(Date);
      expect(lock.isAutoRenewing).toBe(false);
    });

    it('should calculate expiration timestamp correctly', () => {
      // Given
      const now = Date.now();

      // When
      const lock = new Lock(key, token, ttl, mockStore);

      // Then
      const expectedExpiration = now + ttl;
      const actualExpiration = lock.expiresAt.getTime();
      expect(actualExpiration).toBeGreaterThanOrEqual(expectedExpiration - 100);
      expect(actualExpiration).toBeLessThanOrEqual(expectedExpiration + 100);
    });
  });

  describe('release', () => {
    it('should release lock successfully', async () => {
      // Given
      mockStore.release.mockResolvedValue(true);

      // When
      await lock.release();

      // Then
      expect(mockStore.release).toHaveBeenCalledWith(key, token);
    });

    it('should throw LockNotOwnedError when release fails', async () => {
      // Given
      mockStore.release.mockResolvedValue(false);

      // When/Then
      try {
        await lock.release();
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/LockNotOwnedError/);
        expect(error).toBeInstanceOf(LockNotOwnedError);
        expect((error as LockNotOwnedError).lockKey).toBe(key);
        expect((error as LockNotOwnedError).token).toBe(token);
      }
    });

    it('should be idempotent - safe to call multiple times', async () => {
      // Given
      mockStore.release.mockResolvedValue(true);

      // When
      await lock.release();
      await lock.release();
      await lock.release();

      // Then
      expect(mockStore.release).toHaveBeenCalledTimes(1);
    });

    it('should stop auto-renewal on release', async () => {
      // Given
      mockStore.release.mockResolvedValue(true);
      mockStore.extend.mockResolvedValue(true);
      lock.startAutoRenew(1000);

      // When
      await lock.release();

      // Then
      expect(lock.isAutoRenewing).toBe(false);
    });
  });

  describe('extend', () => {
    it('should extend lock TTL successfully', async () => {
      // Given
      const newTtl = 60000;
      mockStore.extend.mockResolvedValue(true);
      const before = lock.expiresAt.getTime();

      // When
      await lock.extend(newTtl);

      // Then
      expect(mockStore.extend).toHaveBeenCalledWith(key, token, newTtl);
      const after = lock.expiresAt.getTime();
      expect(after).toBeGreaterThan(before);
    });

    it('should throw LockExtensionError when extension fails', async () => {
      // Given
      mockStore.extend.mockResolvedValue(false);

      // When/Then
      try {
        await lock.extend(ttl);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/LockExtensionError/);
        expect(error).toBeInstanceOf(LockExtensionError);
        expect((error as LockExtensionError).lockKey).toBe(key);
        expect((error as LockExtensionError).token).toBe(token);
      }
    });

    it('should throw LockNotOwnedError when lock already released', async () => {
      // Given
      mockStore.release.mockResolvedValue(true);
      await lock.release();

      // When/Then
      try {
        await lock.extend(ttl);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/LockNotOwnedError/);
        expect(error).toBeInstanceOf(LockNotOwnedError);
      }
    });

    it('should update expiresAt timestamp', async () => {
      // Given
      const newTtl = 60000;
      mockStore.extend.mockResolvedValue(true);
      const before = Date.now();

      // When
      await lock.extend(newTtl);

      // Then
      const expectedExpiration = before + newTtl;
      const actualExpiration = lock.expiresAt.getTime();
      expect(actualExpiration).toBeGreaterThanOrEqual(expectedExpiration - 100);
      expect(actualExpiration).toBeLessThanOrEqual(expectedExpiration + 100);
    });
  });

  describe('isHeld', () => {
    it('should return true when lock is held', async () => {
      // Given
      mockStore.isHeldBy.mockResolvedValue(true);

      // When
      const result = await lock.isHeld();

      // Then
      expect(result).toBe(true);
      expect(mockStore.isHeldBy).toHaveBeenCalledWith(key, token);
    });

    it('should return false when lock is not held', async () => {
      // Given
      mockStore.isHeldBy.mockResolvedValue(false);

      // When
      const result = await lock.isHeld();

      // Then
      expect(result).toBe(false);
    });

    it('should return false when lock was released', async () => {
      // Given
      mockStore.release.mockResolvedValue(true);
      await lock.release();

      // When
      const result = await lock.isHeld();

      // Then
      expect(result).toBe(false);
      expect(mockStore.isHeldBy).not.toHaveBeenCalled();
    });
  });

  describe('startAutoRenew', () => {
    it('should start automatic renewal', async () => {
      // Given
      const intervalMs = 100;
      mockStore.extend.mockResolvedValue(true);

      // When
      lock.startAutoRenew(intervalMs);

      // Then
      expect(lock.isAutoRenewing).toBe(true);

      // Wait for at least one renewal
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(mockStore.extend).toHaveBeenCalledWith(key, token, ttl);
    });

    it('should be idempotent - not start multiple timers', async () => {
      // Given
      const intervalMs = 100;
      mockStore.extend.mockResolvedValue(true);

      // When
      lock.startAutoRenew(intervalMs);
      lock.startAutoRenew(intervalMs);
      lock.startAutoRenew(intervalMs);

      // Then
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should not create multiple timers
      expect(lock.isAutoRenewing).toBe(true);
    });

    it('should stop renewal when extension fails', async () => {
      // Given
      const intervalMs = 50;
      mockStore.extend.mockResolvedValue(false);

      // When
      lock.startAutoRenew(intervalMs);

      // Then
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(lock.isAutoRenewing).toBe(false);
    });

    it('should continue renewal on successful extensions', async () => {
      // Given
      const intervalMs = 50;
      mockStore.extend.mockResolvedValue(true);

      // When
      lock.startAutoRenew(intervalMs);

      // Then
      await new Promise((resolve) => setTimeout(resolve, 130));

      expect(mockStore.extend).toHaveBeenCalledTimes(2);
      expect(lock.isAutoRenewing).toBe(true);
    });
  });

  describe('stopAutoRenew', () => {
    it('should stop automatic renewal', async () => {
      // Given
      const intervalMs = 100;
      mockStore.extend.mockResolvedValue(true);
      lock.startAutoRenew(intervalMs);

      // When
      lock.stopAutoRenew();

      // Then
      expect(lock.isAutoRenewing).toBe(false);

      await new Promise((resolve) => setTimeout(resolve, 150));
      // Should not have been called after stopping
      expect(mockStore.extend).toHaveBeenCalledTimes(0);
    });

    it('should be safe to call multiple times', () => {
      // Given
      lock.startAutoRenew(100);

      // When
      lock.stopAutoRenew();
      lock.stopAutoRenew();
      lock.stopAutoRenew();

      // Then
      expect(lock.isAutoRenewing).toBe(false);
    });

    it('should be safe to call when not renewing', () => {
      // Given/When
      lock.stopAutoRenew();

      // Then
      expect(lock.isAutoRenewing).toBe(false);
    });
  });

  describe('expiresAt', () => {
    it('should return expiration timestamp', () => {
      // Given/When
      const expiresAt = lock.expiresAt;

      // Then
      expect(expiresAt).toBeInstanceOf(Date);
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('isAutoRenewing', () => {
    it('should return false initially', () => {
      // Given/When/Then
      expect(lock.isAutoRenewing).toBe(false);
    });

    it('should return true when auto-renewing', () => {
      // Given
      mockStore.extend.mockResolvedValue(true);
      lock.startAutoRenew(1000);

      // When/Then
      expect(lock.isAutoRenewing).toBe(true);
    });

    it('should return false after stopping', () => {
      // Given
      mockStore.extend.mockResolvedValue(true);
      lock.startAutoRenew(1000);

      // When
      lock.stopAutoRenew();

      // Then
      expect(lock.isAutoRenewing).toBe(false);
    });
  });
});
