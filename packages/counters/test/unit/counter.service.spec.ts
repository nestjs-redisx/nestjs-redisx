import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';
import { CounterService } from '../../src/counter/application/services/counter.service';
import { InvalidCounterConfigError, CounterValueError } from '../../src/shared/errors';
import { ICounterStore } from '../../src/counter/application/ports/counter-store.port';

function createMockStore(): MockedObject<ICounterStore> {
  return {
    incrementBy: vi.fn().mockResolvedValue(1),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(true),
    getAndReset: vi.fn().mockResolvedValue(0),
  } as MockedObject<ICounterStore>;
}

describe('CounterService', () => {
  let store: MockedObject<ICounterStore>;
  let service: CounterService;

  beforeEach(() => {
    store = createMockStore();
    service = new CounterService({}, store);
  });

  describe('constructor', () => {
    it('should fail fast on an invalid hand-wired config', () => {
      expect(() => new CounterService({ keyPrefix: '' }, store)).toThrow(InvalidCounterConfigError);
    });
  });

  describe('increment / decrement', () => {
    it('should increment by 1 with the default prefix', async () => {
      // Given
      store.incrementBy.mockResolvedValue(5);

      // When/Then
      expect(await service.increment('views')).toBe(5);
      expect(store.incrementBy).toHaveBeenCalledWith('_ctr:views', 1, undefined);
    });

    it('should pass a custom amount and the first-write window TTL', async () => {
      // When
      await service.increment('api:today', 3, { ttl: 86_400_000 });

      // Then
      expect(store.incrementBy).toHaveBeenCalledWith('_ctr:api:today', 3, 86_400_000);
    });

    it('should decrement as a negated increment (and allow going negative)', async () => {
      // Given
      store.incrementBy.mockResolvedValue(-2);

      // When/Then
      expect(await service.decrement('stock', 2)).toBe(-2);
      expect(store.incrementBy).toHaveBeenCalledWith('_ctr:stock', -2, undefined);
    });

    it('should honor a custom key prefix', async () => {
      // Given
      const custom = new CounterService({ keyPrefix: 'ctr!' }, store);

      // When
      await custom.increment('k');

      // Then
      expect(store.incrementBy).toHaveBeenCalledWith('ctr!k', 1, undefined);
    });

    it.each([
      ['zero amount', 0],
      ['fractional amount', 1.5],
      ['NaN amount', Number.NaN],
      ['unsafe amount', Number.MAX_SAFE_INTEGER + 1],
    ])('should reject %s fail-fast', async (_name, by) => {
      await expect(service.increment('k', by)).rejects.toThrow(InvalidCounterConfigError);
      await expect(service.decrement('k', by)).rejects.toThrow(InvalidCounterConfigError);
    });

    it('should reject empty keys and invalid TTLs', async () => {
      await expect(service.increment('')).rejects.toThrow(InvalidCounterConfigError);
      await expect(service.increment('k', 1, { ttl: 0 })).rejects.toThrow(InvalidCounterConfigError);
      await expect(service.increment('k', 1, { ttl: 1.5 })).rejects.toThrow(InvalidCounterConfigError);
    });
  });

  describe('get', () => {
    it('should return 0 for a missing counter', async () => {
      expect(await service.get('absent')).toBe(0);
    });

    it('should return the numeric value', async () => {
      store.get.mockResolvedValue(41);
      expect(await service.get('views')).toBe(41);
    });

    it('should fail loudly on a non-numeric value instead of returning NaN', async () => {
      // Given - the key is shared with something that wrote a string
      store.get.mockResolvedValue(Number.NaN);

      // When/Then
      await expect(service.get('poisoned')).rejects.toThrow(CounterValueError);
    });
  });

  describe('set / reset / getAndReset', () => {
    it('should set an absolute value with and without a TTL', async () => {
      await service.set('k', 10);
      expect(store.set).toHaveBeenCalledWith('_ctr:k', 10, undefined);

      await service.set('k', 10, { ttl: 5_000 });
      expect(store.set).toHaveBeenCalledWith('_ctr:k', 10, 5_000);
    });

    it('should reject non-integer absolute values', async () => {
      await expect(service.set('k', 1.5)).rejects.toThrow(InvalidCounterConfigError);
      await expect(service.set('k', Number.NaN)).rejects.toThrow(InvalidCounterConfigError);
    });

    it('should reset and report existence', async () => {
      expect(await service.reset('k')).toBe(true);
      expect(store.reset).toHaveBeenCalledWith('_ctr:k');
    });

    it('should getAndReset atomically and reject poisoned values', async () => {
      // Given
      store.getAndReset.mockResolvedValue(42);

      // When/Then
      expect(await service.getAndReset('batch')).toBe(42);
      expect(store.getAndReset).toHaveBeenCalledWith('_ctr:batch');

      store.getAndReset.mockResolvedValue(Number.NaN);
      await expect(service.getAndReset('poisoned')).rejects.toThrow(CounterValueError);
    });
  });

  describe('sequences', () => {
    it('should issue monotonic values via next() with NO TTL', async () => {
      // Given
      store.incrementBy.mockResolvedValueOnce(1).mockResolvedValueOnce(2);

      // When/Then
      expect(await service.next('seq:orders')).toBe(1);
      expect(await service.next('seq:orders')).toBe(2);
      expect(store.incrementBy).toHaveBeenCalledWith('_ctr:seq:orders', 1);
    });

    it('should report the last issued value via current() (0 before first)', async () => {
      expect(await service.current('seq:orders')).toBe(0);
      store.get.mockResolvedValue(7);
      expect(await service.current('seq:orders')).toBe(7);
    });
  });
});
