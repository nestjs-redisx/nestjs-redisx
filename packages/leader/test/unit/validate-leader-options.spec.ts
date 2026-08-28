import { describe, it, expect } from 'vitest';
import { validateLeaderOptions } from '../../src/shared/utils/validate-leader-options';
import { InvalidLeaderConfigError } from '../../src/shared/errors';

describe('validateLeaderOptions', () => {
  it('should accept empty options', () => {
    // When/Then
    expect(() => validateLeaderOptions({}, 'test')).not.toThrow();
  });

  it('should accept a fully valid configuration', () => {
    // When/Then
    expect(() =>
      validateLeaderOptions(
        {
          ttlMs: 15_000,
          renewIntervalMs: 5_000,
          retryIntervalMs: 2_000,
          groups: ['reports', 'cleanup'],
          instanceId: 'api-1',
          keyPrefix: 'leader:',
        },
        'test',
      ),
    ).not.toThrow();
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1e21])('should reject invalid ttlMs %p', (ttlMs) => {
    // When/Then
    expect(() => validateLeaderOptions({ ttlMs: ttlMs as number }, 'test')).toThrow(InvalidLeaderConfigError);
  });

  it.each([0, -5, 2.5, Number.NaN])('should reject invalid renewIntervalMs %p', (renewIntervalMs) => {
    // When/Then
    expect(() => validateLeaderOptions({ renewIntervalMs: renewIntervalMs as number }, 'test')).toThrow(InvalidLeaderConfigError);
  });

  it.each([0, -5, 2.5, Number.NaN])('should reject invalid retryIntervalMs %p', (retryIntervalMs) => {
    // When/Then
    expect(() => validateLeaderOptions({ retryIntervalMs: retryIntervalMs as number }, 'test')).toThrow(InvalidLeaderConfigError);
  });

  it('should reject renewIntervalMs >= ttlMs (a lease that expires before its own heartbeat)', () => {
    // When/Then
    expect(() => validateLeaderOptions({ ttlMs: 5000, renewIntervalMs: 5000 }, 'test')).toThrow(InvalidLeaderConfigError);
    expect(() => validateLeaderOptions({ ttlMs: 5000, renewIntervalMs: 6000 }, 'test')).toThrow(InvalidLeaderConfigError);
  });

  it('should validate renewIntervalMs against the DEFAULT ttl when ttlMs is omitted', () => {
    // Given — default ttl is 15000
    // When/Then
    expect(() => validateLeaderOptions({ renewIntervalMs: 15_000 }, 'test')).toThrow(InvalidLeaderConfigError);
    expect(() => validateLeaderOptions({ renewIntervalMs: 14_999 }, 'test')).not.toThrow();
  });

  it('should reject empty or non-string group names', () => {
    // When/Then
    expect(() => validateLeaderOptions({ groups: [''] }, 'test')).toThrow(InvalidLeaderConfigError);
    expect(() => validateLeaderOptions({ groups: ['ok', '  '] }, 'test')).toThrow(InvalidLeaderConfigError);
    expect(() => validateLeaderOptions({ groups: [42 as never] }, 'test')).toThrow(InvalidLeaderConfigError);
  });

  it('should reject an empty instanceId', () => {
    // When/Then
    expect(() => validateLeaderOptions({ instanceId: '' }, 'test')).toThrow(InvalidLeaderConfigError);
    expect(() => validateLeaderOptions({ instanceId: '   ' }, 'test')).toThrow(InvalidLeaderConfigError);
  });

  it('should include the source in the error message', () => {
    // When/Then
    expect(() => validateLeaderOptions({ ttlMs: 0 }, 'LeaderPlugin options')).toThrow(/LeaderPlugin options/);
  });
});
