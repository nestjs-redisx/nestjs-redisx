import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';
import { SemaphoreService } from '../../src/semaphore/application/services/semaphore.service';
import { SemaphoreAcquisitionError, InvalidSemaphoreConfigError, SemaphorePermitNotHeldError } from '../../src/shared/errors';
import { ISemaphoreStore } from '../../src/semaphore/application/ports/semaphore-store.port';
import { ISemaphorePluginOptions } from '../../src/shared/types';

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

const FAST_RETRY: ISemaphorePluginOptions = {
  retry: { maxRetries: 2, initialDelay: 1, maxDelay: 2, multiplier: 1 },
  autoRenew: { enabled: false },
};

describe('SemaphoreService', () => {
  let store: MockedObject<ISemaphoreStore>;
  let service: SemaphoreService;

  beforeEach(() => {
    store = createMockStore();
    service = new SemaphoreService(FAST_RETRY, store);
  });

  describe('constructor', () => {
    it('should fail fast on an invalid hand-wired config (service validates too, not only the plugin)', () => {
      // Given/When/Then
      expect(() => new SemaphoreService({ defaultTtl: -1 }, store)).toThrow(InvalidSemaphoreConfigError);
    });
  });

  describe('acquire', () => {
    it('should return a permit when the store grants a seat', async () => {
      // When
      const permit = await service.acquire('renders', 3);

      // Then — prefixed key, capacity and TTL forwarded, time injected
      expect(permit.key).toBe('_sem:renders');
      expect(store.acquire).toHaveBeenCalledWith('_sem:renders', expect.any(String), 3, 30_000, expect.any(Number));
      await permit.release();
    });

    it('should retry with backoff and succeed when a seat frees up', async () => {
      // Given — full on the first two attempts
      store.acquire.mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

      // When
      const permit = await service.acquire('renders', 2);

      // Then
      expect(store.acquire).toHaveBeenCalledTimes(3);
      await permit.release();
    });

    it('should throw SemaphoreAcquisitionError(timeout) when every retry is exhausted', async () => {
      // Given
      store.acquire.mockResolvedValue(false);

      // When/Then
      await expect(service.acquire('renders', 1)).rejects.toThrow(SemaphoreAcquisitionError);
      expect(store.acquire).toHaveBeenCalledTimes(3); // initial + 2 retries
    });

    it('should stop early when the next sleep would blow the waitTimeout budget', async () => {
      // Given — store always full, generous retries but a tiny wait budget
      store.acquire.mockResolvedValue(false);
      const generous = new SemaphoreService({ retry: { maxRetries: 50, initialDelay: 50, maxDelay: 50, multiplier: 1 }, autoRenew: { enabled: false } }, store);

      // When
      const start = Date.now();
      await expect(generous.acquire('renders', 1, { waitTimeout: 30 })).rejects.toThrow(SemaphoreAcquisitionError);

      // Then — gave up after the first attempt instead of 50 sleeps
      expect(Date.now() - start).toBeLessThan(1_000);
      expect(store.acquire).toHaveBeenCalledTimes(1);
    });

    it('should validate key and permits fail-fast', async () => {
      await expect(service.acquire('', 1)).rejects.toThrow(InvalidSemaphoreConfigError);
      await expect(service.acquire('k', 0)).rejects.toThrow(InvalidSemaphoreConfigError);
    });

    it('should cap the TTL at maxTtl', async () => {
      // Given
      const capped = new SemaphoreService({ ...FAST_RETRY, maxTtl: 5_000 }, store);

      // When
      const permit = await capped.acquire('renders', 1, { ttl: 999_999 });

      // Then
      expect(store.acquire).toHaveBeenCalledWith(expect.any(String), expect.any(String), 1, 5_000, expect.any(Number));
      await permit.release();
    });
  });

  describe('tryAcquire', () => {
    it('should return the permit on success', async () => {
      // When
      const permit = await service.tryAcquire('renders', 2);

      // Then
      expect(permit).not.toBeNull();
      expect(store.acquire).toHaveBeenCalledTimes(1);
      await permit!.release();
    });

    it('should return null when full, without retrying', async () => {
      // Given
      store.acquire.mockResolvedValue(false);

      // When
      const permit = await service.tryAcquire('renders', 2);

      // Then
      expect(permit).toBeNull();
      expect(store.acquire).toHaveBeenCalledTimes(1);
    });
  });

  describe('withPermit', () => {
    it('should run the function under a permit and always release', async () => {
      // When
      const result = await service.withPermit('renders', 2, async () => 'done');

      // Then
      expect(result).toBe('done');
      expect(store.release).toHaveBeenCalledTimes(1);
    });

    it('should release even when the function throws, and rethrow', async () => {
      // When/Then
      await expect(service.withPermit('renders', 2, async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
      expect(store.release).toHaveBeenCalledTimes(1);
    });

    it('should swallow a lost-seat release error (the work already ran)', async () => {
      // Given — the permit expired while the function ran
      store.release.mockResolvedValue(false);

      // When — no throw out of withPermit
      const result = await service.withPermit('renders', 2, async () => 42);

      // Then
      expect(result).toBe(42);
    });
  });

  describe('usedPermits / availablePermits', () => {
    it('should report live holders and remaining capacity', async () => {
      // Given
      store.usedPermits.mockResolvedValue(3);

      // When/Then
      expect(await service.usedPermits('renders')).toBe(3);
      expect(await service.availablePermits('renders', 5)).toBe(2);
    });

    it('should clamp availablePermits at zero when over-subscribed (capacity lowered after acquires)', async () => {
      // Given
      store.usedPermits.mockResolvedValue(7);

      // When/Then
      expect(await service.availablePermits('renders', 5)).toBe(0);
    });
  });

  describe('forceReleaseAll', () => {
    it('should free every seat through the store', async () => {
      // Given
      store.forceReleaseAll.mockResolvedValue(4);

      // When/Then
      expect(await service.forceReleaseAll('renders')).toBe(4);
      expect(store.forceReleaseAll).toHaveBeenCalledWith('_sem:renders');
    });
  });

  describe('auto-renewal wiring', () => {
    it('should start auto-renew by default and honor the per-call opt-out', async () => {
      // Given — plugin default: enabled
      const renewing = new SemaphoreService({ retry: FAST_RETRY.retry }, store);

      // When
      const auto = await renewing.acquire('renders', 1);
      const manual = await renewing.acquire('renders', 1, { autoRenew: false });

      // Then
      expect(auto.isAutoRenewing).toBe(true);
      expect(manual.isAutoRenewing).toBe(false);
      await auto.release();
      await manual.release();
    });
  });

  describe('metrics gauge symmetry', () => {
    it('should decrement the active gauge exactly once per permit, on direct release too', async () => {
      // Given
      const metrics = {
        incrementCounter: vi.fn(),
        observeHistogram: vi.fn(),
        incrementGauge: vi.fn(),
        decrementGauge: vi.fn(),
      };
      const measured = new SemaphoreService(FAST_RETRY, store, metrics);

      // When — direct acquire/release (NOT withPermit)
      const permit = await measured.acquire('renders', 2);
      await permit.release();
      await permit.release(); // idempotent repeat

      // Then — one up, one down
      expect(metrics.incrementGauge).toHaveBeenCalledWith('redisx_semaphore_permits_active');
      expect(metrics.decrementGauge).toHaveBeenCalledTimes(1);
    });
  });

  describe('config resolution branches', () => {
    it('should use library defaults with an empty config', async () => {
      // Given — nothing configured
      const bare = new SemaphoreService({ autoRenew: { enabled: false } }, store);

      // When
      const permit = await bare.acquire('k', 1);

      // Then — default prefix and default TTL
      expect(store.acquire).toHaveBeenCalledWith('_sem:k', expect.any(String), 1, 30_000, expect.any(Number));
      await permit.release();
    });

    it('should honor custom prefix, defaultTtl, and per-call retry overrides', async () => {
      // Given
      store.acquire.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      const custom = new SemaphoreService({ keyPrefix: 'sem!', defaultTtl: 7_000, maxTtl: 8_000, retry: { maxRetries: 0, initialDelay: 50, maxDelay: 60, multiplier: 3 }, autoRenew: { enabled: false } }, store);

      // When — per-call retry override re-enables one retry with a tiny delay
      const permit = await custom.acquire('k', 2, { retry: { maxRetries: 1, initialDelay: 1 } });

      // Then
      expect(store.acquire).toHaveBeenCalledWith('sem!k', expect.any(String), 2, 7_000, expect.any(Number));
      expect(store.acquire).toHaveBeenCalledTimes(2);
      await permit.release();
    });

    it('should honor a custom autoRenew.intervalFraction', async () => {
      // Given
      vi.useFakeTimers();
      const fraction = new SemaphoreService({ defaultTtl: 1_000, autoRenew: { enabled: true, intervalFraction: 0.1 } }, store);

      // When — renewal every 100ms
      const permit = await fraction.acquire('k', 1);
      await vi.advanceTimersByTimeAsync(350);

      // Then
      expect(store.extend).toHaveBeenCalledTimes(3);
      permit.stopAutoRenew();
      vi.useRealTimers();
      await permit.release();
    });

    it('should validate keys on the read/admin APIs too', async () => {
      await expect(service.usedPermits('')).rejects.toThrow(InvalidSemaphoreConfigError);
      await expect(service.availablePermits('', 1)).rejects.toThrow(InvalidSemaphoreConfigError);
      await expect(service.forceReleaseAll('')).rejects.toThrow(InvalidSemaphoreConfigError);
      await expect(service.withPermit('', 1, async () => 1)).rejects.toThrow(InvalidSemaphoreConfigError);
    });
  });

  describe('observability branches', () => {
    it('should record spans on success and failure when tracing is wired', async () => {
      // Given
      const span = { setAttribute: vi.fn().mockReturnThis(), setStatus: vi.fn().mockReturnThis(), recordException: vi.fn().mockReturnThis(), end: vi.fn() };
      const tracing = { startSpan: vi.fn().mockReturnValue(span) };
      const traced = new SemaphoreService(FAST_RETRY, store, undefined, tracing);

      // When — one success, one exhaustion
      const permit = await traced.acquire('ok', 1);
      await permit.release();
      store.acquire.mockResolvedValue(false);
      await expect(traced.acquire('full', 1)).rejects.toThrow(SemaphoreAcquisitionError);

      // Then
      expect(span.setStatus).toHaveBeenCalledWith('OK');
      expect(span.setStatus).toHaveBeenCalledWith('ERROR');
      expect(span.recordException).toHaveBeenCalled();
      expect(span.end).toHaveBeenCalledTimes(2);
    });

    it('should count failed tryAcquire in metrics', async () => {
      // Given
      store.acquire.mockResolvedValue(false);
      const metrics = { incrementCounter: vi.fn(), observeHistogram: vi.fn(), incrementGauge: vi.fn(), decrementGauge: vi.fn() };
      const measured = new SemaphoreService(FAST_RETRY, store, metrics);

      // When
      await measured.tryAcquire('full', 1);

      // Then
      expect(metrics.incrementCounter).toHaveBeenCalledWith('redisx_semaphore_acquisitions_total', { status: 'failed' });
    });
  });

  describe('onModuleDestroy', () => {
    it('should release every still-held permit on shutdown', async () => {
      // Given
      await service.acquire('a', 1);
      await service.acquire('b', 1);

      // When
      await service.onModuleDestroy();

      // Then
      expect(store.release).toHaveBeenCalledTimes(2);
    });

    it('should survive a lost seat during shutdown (logs, never throws)', async () => {
      // Given
      await service.acquire('a', 1);
      store.release.mockRejectedValueOnce(new SemaphorePermitNotHeldError('_sem:a', 'p'));

      // When/Then — no throw
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    });

    it('should not re-release permits the caller already released', async () => {
      // Given
      const permit = await service.acquire('a', 1);
      await permit.release();
      store.release.mockClear();

      // When
      await service.onModuleDestroy();

      // Then — nothing left to release
      expect(store.release).not.toHaveBeenCalled();
    });
  });
});
