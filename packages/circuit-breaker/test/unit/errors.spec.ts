import { describe, it, expect } from 'vitest';
import { InvalidCircuitBreakerConfigError } from '../../src/circuit-breaker/shared/errors';

describe('InvalidCircuitBreakerConfigError', () => {
  it('should be constructable with a message', () => {
    // Given
    const message = 'failureThreshold must be an integer >= 1';

    // When
    const error = new InvalidCircuitBreakerConfigError(message);

    // Then
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(InvalidCircuitBreakerConfigError);
    expect(error.message).toBe(message);
  });

  it('should carry the correct name', () => {
    // Given / When
    const error = new InvalidCircuitBreakerConfigError('bad config');

    // Then
    expect(error.name).toBe('InvalidCircuitBreakerConfigError');
  });
});
