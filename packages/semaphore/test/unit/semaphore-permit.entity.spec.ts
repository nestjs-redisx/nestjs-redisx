import { describe, it, expect, beforeEach, vi, afterEach, type MockedObject } from 'vitest';
import { SemaphorePermit } from '../../src/semaphore/domain/entities/semaphore-permit.entity';
import { SemaphorePermitNotHeldError, SemaphoreExtensionError } from '../../src/shared/errors';
import { ISemaphoreStore } from '../../src/semaphore/application/ports/semaphore-store.port';

function createMockStore(): MockedObject<ISemaphoreStore> {
  return {
    acquire: vi.fn().mockResolvedValue(true),
    release: vi.fn().mockResolvedValue(true),
    extend: vi.fn().mockResolvedValue(true),
    isHeld: vi.fn().mockResolvedValue(true),
    usedPermits: vi.fn().mockResolvedValue(0),
    forceReleaseAll: vi.fn().mockResolvedValue(0),
  } as MockedObject<ISemaphoreStore>;
}

describe('SemaphorePermit', () => {
  let store: MockedObject<ISemaphoreStore>;
  let permit: SemaphorePermit;

  beforeEach(() => {
    store = createMockStore();
    permit = new SemaphorePermit('_sem:renders', 'permit-1', 30_000, store);
  });

  afterEach(() => {
    permit.stopAutoRenew();
    vi.useRealTimers();
  });

  describe('release', () => {
    it('should release the permit through the store', async () => {
      // When
      await permit.release();

      // Then
      expect(store.release).toHaveBeenCalledWith('_sem:renders', 'permit-1');
    });

    it('should be idempotent — a second release is a no-op', async () => {
      // Given
      await permit.release();

      // When
      await permit.release();

      // Then
      expect(store.release).toHaveBeenCalledTimes(1);
    });

    it('should throw SemaphorePermitNotHeldError when the seat was already lost — and still not retry on a repeat call', async () => {
      // Given — the permit expired on the store
      store.release.mockResolvedValue(false);

      // When/Then
      await expect(permit.release()).rejects.toThrow(SemaphorePermitNotHeldError);

      // And the permit is terminally released: no second store round-trip
      await permit.release();
      expect(store.release).toHaveBeenCalledTimes(1);
    });

    it('should stop auto-renewal on release', async () => {
      // Given
      permit.startAutoRenew(1_000);
      expect(permit.isAutoRenewing).toBe(true);

      // When
      await permit.release();

      // Then
      expect(permit.isAutoRenewing).toBe(false);
    });
  });

  describe('extend', () => {
    it('should extend through the store and move expiresAt forward', async () => {
      // Given
      const before = permit.expiresAt.getTime();

      // When
      await permit.extend(60_000);

      // Then
      expect(store.extend).toHaveBeenCalledWith('_sem:renders', 'permit-1', 60_000, expect.any(Number));
      expect(permit.expiresAt.getTime()).toBeGreaterThan(before);
    });

    it('should throw SemaphorePermitNotHeldError after release', async () => {
      // Given
      await permit.release();

      // When/Then
      await expect(permit.extend(10_000)).rejects.toThrow(SemaphorePermitNotHeldError);
    });

    it('should throw SemaphoreExtensionError when the store refuses (permit expired)', async () => {
      // Given
      store.extend.mockResolvedValue(false);

      // When/Then
      await expect(permit.extend(10_000)).rejects.toThrow(SemaphoreExtensionError);
    });
  });

  describe('isHeld', () => {
    it('should consult the store while unreleased', async () => {
      // When
      const held = await permit.isHeld();

      // Then
      expect(held).toBe(true);
      expect(store.isHeld).toHaveBeenCalledWith('_sem:renders', 'permit-1', expect.any(Number));
    });

    it('should short-circuit to false after release', async () => {
      // Given
      await permit.release();
      store.isHeld.mockClear();

      // When
      const held = await permit.isHeld();

      // Then
      expect(held).toBe(false);
      expect(store.isHeld).not.toHaveBeenCalled();
    });
  });

  describe('auto-renewal', () => {
    it('should renew at the configured interval', async () => {
      // Given
      vi.useFakeTimers();
      permit.startAutoRenew(1_000);

      // When
      await vi.advanceTimersByTimeAsync(2_100);

      // Then — two renewal rounds with the original TTL
      expect(store.extend).toHaveBeenCalledTimes(2);
      expect(store.extend).toHaveBeenCalledWith('_sem:renders', 'permit-1', 30_000, expect.any(Number));
    });

    it('should stop renewing after a failed extension (permit lost) and flip isAutoRenewing', async () => {
      // Given
      vi.useFakeTimers();
      store.extend.mockResolvedValue(false);
      permit.startAutoRenew(1_000);

      // When
      await vi.advanceTimersByTimeAsync(3_100);

      // Then — one attempt, then renewal stops
      expect(store.extend).toHaveBeenCalledTimes(1);
      expect(permit.isAutoRenewing).toBe(false);
    });

    it('should ignore a second startAutoRenew while one is active', () => {
      // Given
      permit.startAutoRenew(1_000);

      // When
      permit.startAutoRenew(5);

      // Then
      expect(permit.isAutoRenewing).toBe(true);
      permit.stopAutoRenew();
      expect(permit.isAutoRenewing).toBe(false);
    });
  });
});
