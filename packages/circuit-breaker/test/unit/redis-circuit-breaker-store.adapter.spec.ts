import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';
import { RedisCircuitBreakerStoreAdapter } from '../../src/circuit-breaker/infrastructure/adapters/redis-circuit-breaker-store.adapter';
import { CircuitBreakerStoreError } from '../../src/shared/errors';
import type { IRedisDriver } from '@nestjs-redisx/core';
import type { ICircuitBreakerConfig } from '../../src/circuit-breaker/domain/circuit-breaker-state.interface';

const CONFIG: ICircuitBreakerConfig = {
  failureThreshold: 3,
  windowMs: 1000,
  openDurationMs: 5000,
  halfOpenMaxCalls: 2,
  successThreshold: 2,
};

function createDriver(): MockedObject<IRedisDriver> {
  return {
    scriptLoad: vi.fn().mockResolvedValue('sha'),
    evalsha: vi.fn(),
    eval: vi.fn(),
    del: vi.fn().mockResolvedValue(1),
  } as unknown as MockedObject<IRedisDriver>;
}

describe('RedisCircuitBreakerStoreAdapter', () => {
  let driver: MockedObject<IRedisDriver>;
  let adapter: RedisCircuitBreakerStoreAdapter;

  beforeEach(() => {
    driver = createDriver();
    adapter = new RedisCircuitBreakerStoreAdapter(driver);
  });

  describe('onModuleInit', () => {
    it('should preload all four Lua scripts', async () => {
      // When
      await adapter.onModuleInit();

      // Then
      expect(driver.scriptLoad).toHaveBeenCalledTimes(4);
    });

    it('should wrap script-load failures in CircuitBreakerStoreError', async () => {
      // Given
      driver.scriptLoad.mockRejectedValueOnce(new Error('load failed'));

      // When / Then
      await expect(adapter.onModuleInit()).rejects.toBeInstanceOf(CircuitBreakerStoreError);
    });
  });

  describe('canRequest', () => {
    it('should parse the decision from the script result', async () => {
      // Given — {allowed, stateCode, failuresInWindow, hoSucc, hoInflight}
      await adapter.onModuleInit();
      driver.evalsha.mockResolvedValue([1, 2, 0, 0, 1]);

      // When
      const decision = await adapter.canRequest('cb:x', CONFIG);

      // Then
      expect(decision.allowed).toBe(true);
      expect(decision.snapshot).toEqual({ state: 'half-open', failuresInWindow: 0, halfOpenSuccesses: 0, halfOpenInFlight: 1 });
      // keys are hash-tagged and share a slot: {cb:x} and {cb:x}:f
      expect(driver.evalsha).toHaveBeenCalledWith('sha', ['{cb:x}', '{cb:x}:f'], expect.arrayContaining([3, 1000, 5000, 2, 2]));
    });

    it('should fall back to EVAL on a NOSCRIPT error', async () => {
      // Given
      await adapter.onModuleInit();
      driver.evalsha.mockRejectedValue(new Error('NOSCRIPT No matching script'));
      driver.eval.mockResolvedValue([0, 1, 0, 0, 0]);

      // When
      const decision = await adapter.canRequest('cb:x', CONFIG);

      // Then
      expect(driver.eval).toHaveBeenCalledTimes(1);
      expect(decision.allowed).toBe(false);
      expect(decision.snapshot.state).toBe('open');
    });

    it('should use EVAL directly when scripts were never preloaded (sha null)', async () => {
      // Given — no onModuleInit()
      driver.eval.mockResolvedValue([1, 0, 0, 0, 0]);

      // When
      const decision = await adapter.canRequest('cb:x', CONFIG);

      // Then
      expect(driver.evalsha).not.toHaveBeenCalled();
      expect(driver.eval).toHaveBeenCalledTimes(1);
      expect(decision.snapshot.state).toBe('closed');
    });

    it('should wrap non-NOSCRIPT errors in CircuitBreakerStoreError', async () => {
      // Given
      await adapter.onModuleInit();
      driver.evalsha.mockRejectedValue(new Error('connection reset'));

      // When / Then
      await expect(adapter.canRequest('cb:x', CONFIG)).rejects.toBeInstanceOf(CircuitBreakerStoreError);
    });
  });

  describe('record & getState', () => {
    beforeEach(async () => {
      await adapter.onModuleInit();
    });

    it('recordFailure should pass a unique member and parse the snapshot', async () => {
      // Given
      driver.evalsha.mockResolvedValue([1, 0, 0, 0]);

      // When
      const snapshot = await adapter.recordFailure('cb:x', CONFIG);

      // Then
      expect(snapshot.state).toBe('open');
      const args = driver.evalsha.mock.calls[0][2] as unknown[];
      expect(args).toHaveLength(7); // 5 config + now + member
      expect(typeof args[6]).toBe('string');
    });

    it('recordSuccess should parse the snapshot', async () => {
      // Given
      driver.evalsha.mockResolvedValue([2, 0, 1, 0]);

      // When
      const snapshot = await adapter.recordSuccess('cb:x', CONFIG);

      // Then
      expect(snapshot).toEqual({ state: 'half-open', failuresInWindow: 0, halfOpenSuccesses: 1, halfOpenInFlight: 0 });
    });

    it('getState should parse a closed snapshot with a failure count', async () => {
      // Given
      driver.evalsha.mockResolvedValue([0, 2, 0, 0]);

      // When
      const snapshot = await adapter.getState('cb:x', CONFIG);

      // Then
      expect(snapshot).toEqual({ state: 'closed', failuresInWindow: 2, halfOpenSuccesses: 0, halfOpenInFlight: 0 });
    });

    it('recordSuccess should wrap store errors', async () => {
      // Given
      driver.evalsha.mockRejectedValue(new Error('boom'));

      // When / Then
      await expect(adapter.recordSuccess('cb:x', CONFIG)).rejects.toBeInstanceOf(CircuitBreakerStoreError);
    });

    it('recordFailure should fall back to EVAL on a NOSCRIPT error', async () => {
      // Given
      driver.evalsha.mockRejectedValue(new Error('NOSCRIPT No matching script'));
      driver.eval.mockResolvedValue([1, 0, 0, 0]);

      // When
      const snapshot = await adapter.recordFailure('cb:x', CONFIG);

      // Then
      expect(driver.eval).toHaveBeenCalledTimes(1);
      expect(snapshot.state).toBe('open');
    });

    it('getState should fall back to EVAL on a NOSCRIPT error', async () => {
      // Given
      driver.evalsha.mockRejectedValue(new Error('NOSCRIPT No matching script'));
      driver.eval.mockResolvedValue([0, 1, 0, 0]);

      // When
      const snapshot = await adapter.getState('cb:x', CONFIG);

      // Then
      expect(driver.eval).toHaveBeenCalledTimes(1);
      expect(snapshot).toEqual({ state: 'closed', failuresInWindow: 1, halfOpenSuccesses: 0, halfOpenInFlight: 0 });
    });

    it('recordSuccess should fall back to EVAL on a NOSCRIPT error', async () => {
      // Given
      driver.evalsha.mockRejectedValue(new Error('NOSCRIPT No matching script'));
      driver.eval.mockResolvedValue([0, 0, 0, 0]);

      // When
      const snapshot = await adapter.recordSuccess('cb:x', CONFIG);

      // Then
      expect(driver.eval).toHaveBeenCalledTimes(1);
      expect(snapshot.state).toBe('closed');
    });
  });

  describe('reset', () => {
    it('should delete the state and failures keys in a single atomic DEL', async () => {
      // When
      await adapter.reset('cb:x');

      // Then — one variadic DEL, both keys share a hash tag (same cluster slot)
      expect(driver.del).toHaveBeenCalledTimes(1);
      expect(driver.del).toHaveBeenCalledWith('{cb:x}', '{cb:x}:f');
    });

    it('should wrap deletion errors', async () => {
      // Given
      driver.del.mockRejectedValue(new Error('del failed'));

      // When / Then
      await expect(adapter.reset('cb:x')).rejects.toBeInstanceOf(CircuitBreakerStoreError);
    });
  });
});
