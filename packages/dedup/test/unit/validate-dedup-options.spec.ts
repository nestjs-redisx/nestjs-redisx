import { describe, it, expect } from 'vitest';
import { InvalidDedupConfigError } from '../../src/shared/errors';
import { validateDedupOptions, validateDedupCall } from '../../src/shared/utils/validate-dedup-options';

describe('validateDedupOptions', () => {
  it('should accept an empty config (all defaults)', () => {
    expect(() => validateDedupOptions({})).not.toThrow();
  });

  it('should accept a fully specified valid config', () => {
    expect(() => validateDedupOptions({ client: 'c', keyPrefix: 'dd:', defaultWindow: 1_000, errorPolicy: 'fail-closed' })).not.toThrow();
  });

  it.each([
    ['empty keyPrefix', { keyPrefix: '' }],
    ['non-string keyPrefix', { keyPrefix: 1 as unknown as string }],
    ['zero defaultWindow', { defaultWindow: 0 }],
    ['negative defaultWindow', { defaultWindow: -5 }],
    ['NaN defaultWindow', { defaultWindow: Number.NaN }],
    ['fractional defaultWindow', { defaultWindow: 1.5 }],
    ['unknown errorPolicy', { errorPolicy: 'explode' as never }],
  ])('should reject %s', (_name, options) => {
    expect(() => validateDedupOptions(options)).toThrow(InvalidDedupConfigError);
  });

  it('should name the source and render NaN truthfully', () => {
    expect(() => validateDedupOptions({ defaultWindow: Number.NaN }, 'DedupService')).toThrow(/DedupService: defaultWindow.*NaN/);
  });
});

describe('validateDedupCall', () => {
  it('should accept a valid key with and without a window', () => {
    expect(() => validateDedupCall('k', undefined, 'isFirst')).not.toThrow();
    expect(() => validateDedupCall('k', 500, 'isFirst')).not.toThrow();
  });

  it.each([
    ['empty key', '', undefined],
    ['whitespace key', '  ', undefined],
    ['non-string key', 7, undefined],
    ['zero window', 'k', 0],
    ['negative window', 'k', -1],
    ['fractional window', 'k', 0.5],
  ])('should reject %s', (_name, key, window) => {
    expect(() => validateDedupCall(key, window as number | undefined, 'dedupe')).toThrow(InvalidDedupConfigError);
  });

  it('should tag the error with the calling API', () => {
    expect(() => validateDedupCall('', undefined, 'debounce')).toThrow(/debounce:/);
  });
});
