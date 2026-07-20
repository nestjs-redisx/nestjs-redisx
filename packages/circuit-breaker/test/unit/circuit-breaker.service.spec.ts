import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';
import { CircuitBreakerService } from '../../src/circuit-breaker/application/services/circuit-breaker.service';
import { CircuitBreakerOpenError } from '../../src/circuit-breaker/shared/errors';
import type { ICircuitBreakerStore } from '../../src/circuit-breaker/application/ports/circuit-breaker-store.port';
import type { ICircuitBreakerPluginOptions } from '../../src/circuit-breaker/shared/types';
import type { ICircuitSnapshot } from '../../src/circuit-breaker/domain/circuit-breaker-state.interface';

function closedSnapshot(): ICircuitSnapshot {
  return { state: 'closed', failuresInWindow: 0, halfOpenSuccesses: 0, halfOpenInFlight: 0 };
}

function openSnapshot(): ICircuitSnapshot {
  return { state: 'open', failuresInWindow: 0, halfOpenSuccesses: 0, halfOpenInFlight: 0 };
}

describe('CircuitBreakerService', () => {
  let service: CircuitBreakerService;
  let store: MockedObject<ICircuitBreakerStore>;
  let options: ICircuitBreakerPluginOptions;

  beforeEach(() => {
    store = {
      canRequest: vi.fn().mockResolvedValue({ allowed: true, snapshot: closedSnapshot() }),
      recordSuccess: vi.fn().mockResolvedValue(closedSnapshot()),
      recordFailure: vi.fn().mockResolvedValue(closedSnapshot()),
      getState: vi.fn().mockResolvedValue(closedSnapshot()),
      reset: vi.fn().mockResolvedValue(undefined),
    } as unknown as MockedObject<ICircuitBreakerStore>;

    options = {
      keyPrefix: 'cb:',
      failureThreshold: 3,
      windowMs: 1000,
      openDurationMs: 5000,
      halfOpenMaxCalls: 2,
      successThreshold: 2,
      errorPolicy: 'fail-closed',
    };

    service = new CircuitBreakerService(options, store);
  });

  describe('execute — happy path', () => {
    it('should run the function, record success, and return its result', async () => {
      // Given
      const fn = vi.fn().mockResolvedValue('ok');

      // When
      const result = await service.execute('api', fn);

      // Then
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(store.canRequest).toHaveBeenCalledWith('cb:api', expect.objectContaining({ failureThreshold: 3, windowMs: 1000 }));
      expect(store.recordSuccess).toHaveBeenCalledWith('cb:api', expect.any(Object));
      expect(store.recordFailure).not.toHaveBeenCalled();
    });

    it('should record failure and rethrow when the function throws', async () => {
      // Given
      const boom = new Error('boom');
      const fn = vi.fn().mockRejectedValue(boom);

      // When / Then
      await expect(service.execute('api', fn)).rejects.toThrow('boom');
      expect(store.recordFailure).toHaveBeenCalledWith('cb:api', expect.any(Object));
      expect(store.recordSuccess).not.toHaveBeenCalled();
    });
  });

  describe('execute — breaker rejects (open)', () => {
    beforeEach(() => {
      store.canRequest.mockResolvedValue({ allowed: false, snapshot: openSnapshot() });
    });

    it('should throw CircuitBreakerOpenError and NOT run the function by default', async () => {
      // Given
      const fn = vi.fn();

      // When / Then
      await expect(service.execute('api', fn)).rejects.toBeInstanceOf(CircuitBreakerOpenError);
      expect(fn).not.toHaveBeenCalled();
      expect(store.recordSuccess).not.toHaveBeenCalled();
      expect(store.recordFailure).not.toHaveBeenCalled();
    });

    it('should return the fallback result instead of throwing when provided', async () => {
      // Given
      const fn = vi.fn();

      // When
      const result = await service.execute('api', fn, { fallback: () => 'fallback' });

      // Then
      expect(result).toBe('fallback');
      expect(fn).not.toHaveBeenCalled();
    });

    it('should throw the plugin errorFactory error when configured', async () => {
      // Given
      class CustomError extends Error {}
      service = new CircuitBreakerService({ ...options, errorFactory: () => new CustomError('custom') }, store);

      // When / Then
      await expect(service.execute('api', vi.fn())).rejects.toBeInstanceOf(CustomError);
    });
  });

  describe('execute — store failure & errorPolicy', () => {
    it('fail-open: should run the function when the store fails', async () => {
      // Given
      service = new CircuitBreakerService({ ...options, errorPolicy: 'fail-open' }, store);
      store.canRequest.mockRejectedValue(new Error('redis down'));
      const fn = vi.fn().mockResolvedValue('served');

      // When
      const result = await service.execute('api', fn);

      // Then
      expect(result).toBe('served');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('fail-closed: should propagate the store error and not run the function', async () => {
      // Given (default errorPolicy is fail-closed)
      store.canRequest.mockRejectedValue(new Error('redis down'));
      const fn = vi.fn();

      // When / Then
      await expect(service.execute('api', fn)).rejects.toThrow('redis down');
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('execute — record errors do not mask the result', () => {
    it('should still return the result when recordSuccess fails', async () => {
      // Given
      store.recordSuccess.mockRejectedValue(new Error('record failed'));
      const fn = vi.fn().mockResolvedValue('ok');

      // When
      const result = await service.execute('api', fn);

      // Then
      expect(result).toBe('ok');
    });

    it('should still rethrow the original error when recordFailure fails', async () => {
      // Given
      store.recordFailure.mockRejectedValue(new Error('record failed'));
      const fn = vi.fn().mockRejectedValue(new Error('original'));

      // When / Then
      await expect(service.execute('api', fn)).rejects.toThrow('original');
    });
  });

  describe('manual API & config resolution', () => {
    it('should prefix keys and resolve per-call overrides over plugin defaults', async () => {
      // When
      await service.recordFailure('svc', { failureThreshold: 99 });

      // Then
      expect(store.recordFailure).toHaveBeenCalledWith('cb:svc', expect.objectContaining({ failureThreshold: 99, windowMs: 1000 }));
    });

    it('should delegate getState and reset with the prefixed key', async () => {
      // When
      await service.getState('svc');
      await service.reset('svc');

      // Then
      expect(store.getState).toHaveBeenCalledWith('cb:svc', expect.any(Object));
      expect(store.reset).toHaveBeenCalledWith('cb:svc');
    });
  });
});
