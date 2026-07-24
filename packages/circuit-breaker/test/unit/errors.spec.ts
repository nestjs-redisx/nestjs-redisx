import { describe, it, expect } from 'vitest';
import { RedisXError, ErrorCode } from '@nestjs-redisx/core';
import { CircuitBreakerError, CircuitBreakerOpenError, CircuitBreakerStoreError, InvalidCircuitBreakerConfigError } from '../../src/shared/errors';
import type { ICircuitSnapshot } from '../../src/circuit-breaker/domain/circuit-breaker-state.interface';

const openSnapshot: ICircuitSnapshot = { state: 'open', failuresInWindow: 0, halfOpenSuccesses: 0, halfOpenInFlight: 0 };

describe('CircuitBreakerError', () => {
  it('should create the base error with message and code', () => {
    // Given / When
    const error = new CircuitBreakerError('base failure', ErrorCode.CIRCUIT_BREAKER_STORE_ERROR);

    // Then
    expect(error).toBeInstanceOf(RedisXError);
    expect(error.message).toBe('base failure');
    expect(error.code).toBe(ErrorCode.CIRCUIT_BREAKER_STORE_ERROR);
  });

  it('should preserve cause and context', () => {
    // Given
    const cause = new Error('root');

    // When
    const error = new CircuitBreakerError('wrapped', ErrorCode.CIRCUIT_BREAKER_STORE_ERROR, cause, { key: 'k' });

    // Then
    expect(error.cause).toBe(cause);
    expect(error.context).toEqual({ key: 'k' });
  });
});

describe('CircuitBreakerOpenError', () => {
  it('should carry the key, snapshot, code, and a descriptive message', () => {
    // Given / When
    const error = new CircuitBreakerOpenError('cb:payments', openSnapshot);

    // Then
    expect(error).toBeInstanceOf(CircuitBreakerError);
    expect(error).toBeInstanceOf(RedisXError);
    expect(error.key).toBe('cb:payments');
    expect(error.circuitSnapshot).toBe(openSnapshot);
    expect(error.code).toBe(ErrorCode.CIRCUIT_BREAKER_OPEN);
    expect(error.message).toContain('cb:payments');
    expect(error.message).toContain('open');
  });

  it('should expose the key and state in context for structured logging', () => {
    // Given / When
    const error = new CircuitBreakerOpenError('cb:x', openSnapshot);

    // Then
    expect(error.context).toEqual({ key: 'cb:x', state: 'open' });
  });

  it('should serialize to JSON with name, code, and context', () => {
    // Given
    const error = new CircuitBreakerOpenError('cb:x', openSnapshot);

    // When
    const json = error.toJSON();

    // Then
    expect(json.name).toBe('CircuitBreakerOpenError');
    expect(json.code).toBe(ErrorCode.CIRCUIT_BREAKER_OPEN);
    expect(json.context).toEqual({ key: 'cb:x', state: 'open' });
  });
});

describe('CircuitBreakerStoreError', () => {
  it('should create the store error with the correct code', () => {
    // Given / When
    const error = new CircuitBreakerStoreError('lua failed');

    // Then
    expect(error).toBeInstanceOf(CircuitBreakerError);
    expect(error.code).toBe(ErrorCode.CIRCUIT_BREAKER_STORE_ERROR);
    expect(error.message).toBe('lua failed');
  });

  it('should chain the underlying cause', () => {
    // Given
    const cause = new Error('NOSCRIPT');

    // When
    const error = new CircuitBreakerStoreError('script load failed', cause);

    // Then
    expect(error.cause).toBe(cause);
  });
});

describe('InvalidCircuitBreakerConfigError', () => {
  it('should be constructable with a message', () => {
    // Given
    const message = 'failureThreshold must be an integer >= 1';

    // When
    const error = new InvalidCircuitBreakerConfigError(message);

    // Then
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(CircuitBreakerError);
    expect(error).toBeInstanceOf(InvalidCircuitBreakerConfigError);
    expect(error.message).toBe(message);
  });

  it('should carry the correct name and code', () => {
    // Given / When
    const error = new InvalidCircuitBreakerConfigError('bad config');

    // Then
    expect(error.name).toBe('InvalidCircuitBreakerConfigError');
    expect(error.code).toBe(ErrorCode.CIRCUIT_BREAKER_CONFIG_INVALID);
  });
});
