import { describe, it, expect } from 'vitest';
import { InvalidSemaphoreConfigError } from '../../src/shared/errors';
import { validateSemaphoreOptions, validateSemaphoreCall } from '../../src/shared/utils/validate-semaphore-options';

describe('validateSemaphoreOptions', () => {
  it('should accept an empty config (all defaults)', () => {
    expect(() => validateSemaphoreOptions({})).not.toThrow();
  });

  it('should accept a fully specified valid config', () => {
    expect(() =>
      validateSemaphoreOptions({
        client: 'cache',
        keyPrefix: 'sem:',
        defaultTtl: 10_000,
        maxTtl: 60_000,
        retry: { maxRetries: 0, initialDelay: 50, maxDelay: 1_000, multiplier: 1 },
        autoRenew: { enabled: false, intervalFraction: 0.25 },
      }),
    ).not.toThrow();
  });

  it.each([
    ['empty keyPrefix', { keyPrefix: '' }],
    ['non-string keyPrefix', { keyPrefix: 42 as unknown as string }],
    ['zero defaultTtl', { defaultTtl: 0 }],
    ['negative defaultTtl', { defaultTtl: -1 }],
    ['NaN defaultTtl', { defaultTtl: Number.NaN }],
    ['fractional defaultTtl', { defaultTtl: 1.5 }],
    ['zero maxTtl', { maxTtl: 0 }],
    ['defaultTtl above maxTtl', { defaultTtl: 2_000, maxTtl: 1_000 }],
    ['negative maxRetries', { retry: { maxRetries: -1 } }],
    ['fractional maxRetries', { retry: { maxRetries: 1.5 } }],
    ['zero initialDelay', { retry: { initialDelay: 0 } }],
    ['zero maxDelay', { retry: { maxDelay: 0 } }],
    ['multiplier below 1', { retry: { multiplier: 0.5 } }],
    ['non-finite multiplier', { retry: { multiplier: Number.POSITIVE_INFINITY } }],
    ['intervalFraction of 0', { autoRenew: { intervalFraction: 0 } }],
    ['intervalFraction of 1', { autoRenew: { intervalFraction: 1 } }],
    ['NaN intervalFraction', { autoRenew: { intervalFraction: Number.NaN } }],
  ])('should reject %s', (_name, options) => {
    expect(() => validateSemaphoreOptions(options)).toThrow(InvalidSemaphoreConfigError);
  });

  it('should name the offending option and the source in the message', () => {
    expect(() => validateSemaphoreOptions({ defaultTtl: -5 }, 'SemaphoreService')).toThrow(/SemaphoreService: defaultTtl.*-5/);
  });

  it('should render NaN truthfully instead of null (env-var accident)', () => {
    // Number(unsetEnvVar) compiles clean and is NaN at runtime - the message
    // must point at NaN, not at a null that never existed.
    expect(() => validateSemaphoreOptions({ defaultTtl: Number.NaN })).toThrow(/NaN/);
  });
});

describe('validateSemaphoreCall', () => {
  it('should accept a valid key and capacity', () => {
    expect(() => validateSemaphoreCall('renders', 4, 'acquire')).not.toThrow();
  });

  it.each([
    ['empty key', '', 1],
    ['whitespace key', '   ', 1],
    ['non-string key', 42, 1],
    ['zero permits', 'k', 0],
    ['negative permits', 'k', -2],
    ['fractional permits', 'k', 1.5],
    ['NaN permits', 'k', Number.NaN],
  ])('should reject %s', (_name, key, permits) => {
    expect(() => validateSemaphoreCall(key, permits, 'acquire')).toThrow(InvalidSemaphoreConfigError);
  });

  it('should tag the error with the calling API', () => {
    expect(() => validateSemaphoreCall('', 1, 'tryAcquire')).toThrow(/tryAcquire:/);
  });
});
