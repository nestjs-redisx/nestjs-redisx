import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';
import { DedupService } from '../../src/dedup/application/services/dedup.service';
import { InvalidDedupConfigError, DedupStoreError } from '../../src/shared/errors';
import { IDedupStore } from '../../src/dedup/application/ports/dedup-store.port';

function createMockStore(): MockedObject<IDedupStore> {
  return {
    markFirst: vi.fn().mockResolvedValue(true),
    releaseIfOwner: vi.fn().mockResolvedValue(true),
    release: vi.fn().mockResolvedValue(true),
    stampLastCall: vi.fn().mockResolvedValue(undefined),
    claimLastCall: vi.fn().mockResolvedValue(true),
  } as MockedObject<IDedupStore>;
}

describe('DedupService', () => {
  let store: MockedObject<IDedupStore>;
  let service: DedupService;

  beforeEach(() => {
    store = createMockStore();
    service = new DedupService({}, store);
  });

  describe('constructor', () => {
    it('should fail fast on an invalid hand-wired config', () => {
      expect(() => new DedupService({ defaultWindow: -1 }, store)).toThrow(InvalidDedupConfigError);
    });
  });

  describe('isFirst (strict API)', () => {
    it('should mark and report the first occurrence with the default window and prefix', async () => {
      // When
      const first = await service.isFirst('webhook:1');

      // Then
      expect(first).toBe(true);
      expect(store.markFirst).toHaveBeenCalledWith('_dedup:webhook:1', expect.any(String), 60_000);
    });

    it('should report duplicates as false', async () => {
      // Given
      store.markFirst.mockResolvedValue(false);

      // When/Then
      expect(await service.isFirst('webhook:1')).toBe(false);
    });

    it('should honor a per-call window and custom prefix', async () => {
      // Given
      const custom = new DedupService({ keyPrefix: 'dd!', defaultWindow: 5_000 }, store);

      // When
      await custom.isFirst('k', { window: 250 });
      await custom.isFirst('k');

      // Then
      expect(store.markFirst).toHaveBeenNthCalledWith(1, 'dd!k', expect.any(String), 250);
      expect(store.markFirst).toHaveBeenNthCalledWith(2, 'dd!k', expect.any(String), 5_000);
    });

    it('should ALWAYS throw DedupStoreError on store failure (never fail-open)', async () => {
      // Given — even with the fail-open policy
      store.markFirst.mockRejectedValue(new Error('down'));
      const failOpen = new DedupService({ errorPolicy: 'fail-open' }, store);

      // When/Then
      await expect(failOpen.isFirst('k')).rejects.toThrow(DedupStoreError);
    });

    it('should validate inputs fail-fast', async () => {
      await expect(service.isFirst('')).rejects.toThrow(InvalidDedupConfigError);
      await expect(service.isFirst('k', { window: 0 })).rejects.toThrow(InvalidDedupConfigError);
    });

    it('should count outcomes in metrics', async () => {
      // Given
      const metrics = { incrementCounter: vi.fn() };
      const measured = new DedupService({}, store, metrics);
      store.markFirst.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      // When
      await measured.isFirst('k');
      await measured.isFirst('k');

      // Then
      expect(metrics.incrementCounter).toHaveBeenCalledWith('redisx_dedup_checks_total', { outcome: 'first' });
      expect(metrics.incrementCounter).toHaveBeenCalledWith('redisx_dedup_checks_total', { outcome: 'duplicate' });
    });
  });

  describe('dedupe (gate)', () => {
    it('should run the function for the first occurrence and return its result', async () => {
      // When
      const result = await service.dedupe('evt', async () => 42);

      // Then
      expect(result).toBe(42);
    });

    it('should skip duplicates and resolve undefined without running the function', async () => {
      // Given
      store.markFirst.mockResolvedValue(false);
      const fn = vi.fn();

      // When
      const result = await service.dedupe('evt', fn);

      // Then
      expect(result).toBeUndefined();
      expect(fn).not.toHaveBeenCalled();
    });

    it('should re-open the window when the function throws (CAS release of OUR marker) and rethrow', async () => {
      // When/Then
      await expect(service.dedupe('evt', async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');

      // Then — releaseIfOwner with the SAME token markFirst used
      const token = store.markFirst.mock.calls[0]![1];
      expect(store.releaseIfOwner).toHaveBeenCalledWith('_dedup:evt', token);
    });

    it('should surface the business error even when the window re-open itself fails', async () => {
      // Given
      store.releaseIfOwner.mockRejectedValue(new Error('release down'));

      // When/Then — the ORIGINAL error wins, the release failure is logged
      await expect(service.dedupe('evt', async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    });

    it('should run the function on store failure under fail-open (default), loudly', async () => {
      // Given
      store.markFirst.mockRejectedValue(new Error('down'));

      // When
      const result = await service.dedupe('evt', async () => 'ran-anyway');

      // Then
      expect(result).toBe('ran-anyway');
    });

    it('should throw DedupStoreError on store failure under fail-closed', async () => {
      // Given
      store.markFirst.mockRejectedValue(new Error('down'));
      const closed = new DedupService({ errorPolicy: 'fail-closed' }, store);
      const fn = vi.fn();

      // When/Then
      await expect(closed.dedupe('evt', fn)).rejects.toThrow(DedupStoreError);
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('debounce (gate)', () => {
    it('should execute on the caller that stays LAST through the quiet window', async () => {
      // When
      const result = await service.debounce('reindex', async () => 'rebuilt', { window: 20 });

      // Then — stamped, waited, claimed, ran
      expect(result).toBe('rebuilt');
      expect(store.stampLastCall).toHaveBeenCalledWith('_dedup:debounce:reindex', expect.any(String), 20 + 1_000);
      const callId = store.stampLastCall.mock.calls[0]![1];
      expect(store.claimLastCall).toHaveBeenCalledWith('_dedup:debounce:reindex', callId);
    });

    it('should resolve undefined for a superseded call (claim refused)', async () => {
      // Given — a newer call overwrote the slot during the window
      store.claimLastCall.mockResolvedValue(false);
      const fn = vi.fn();

      // When
      const result = await service.debounce('reindex', fn, { window: 10 });

      // Then
      expect(result).toBeUndefined();
      expect(fn).not.toHaveBeenCalled();
    });

    it('should apply the errorPolicy to stamp failures (fail-open runs immediately)', async () => {
      // Given
      store.stampLastCall.mockRejectedValue(new Error('down'));

      // When
      const result = await service.debounce('reindex', async () => 'ran', { window: 5 });

      // Then — no wait, direct fail-open execution
      expect(result).toBe('ran');
      expect(store.claimLastCall).not.toHaveBeenCalled();
    });

    it('should apply the errorPolicy to claim failures (fail-closed throws)', async () => {
      // Given
      store.claimLastCall.mockRejectedValue(new Error('down'));
      const closed = new DedupService({ errorPolicy: 'fail-closed' }, store);

      // When/Then
      await expect(closed.debounce('reindex', async () => 'never', { window: 5 })).rejects.toThrow(DedupStoreError);
    });
  });

  describe('release (strict API)', () => {
    it('should remove the marker unconditionally', async () => {
      // When/Then
      expect(await service.release('evt')).toBe(true);
      expect(store.release).toHaveBeenCalledWith('_dedup:evt');
    });

    it('should ALWAYS throw DedupStoreError on store failure', async () => {
      // Given
      store.release.mockRejectedValue(new Error('down'));

      // When/Then
      await expect(service.release('evt')).rejects.toThrow(DedupStoreError);
    });
  });
});
