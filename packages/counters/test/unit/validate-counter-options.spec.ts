import { describe, it, expect } from 'vitest';
import { InvalidCounterConfigError } from '../../src/shared/errors';
import { validateCountersOptions, validateCounterKey, validateCounterAmount, validateCounterValue, validateCounterTtl } from '../../src/shared/utils/validate-counter-options';

describe('counters validation', () => {
  it('should accept valid plugin options', () => {
    expect(() => validateCountersOptions({})).not.toThrow();
    expect(() => validateCountersOptions({ client: 'c', keyPrefix: 'ctr:' })).not.toThrow();
  });

  it('should reject an empty or non-string keyPrefix', () => {
    expect(() => validateCountersOptions({ keyPrefix: '' })).toThrow(InvalidCounterConfigError);
    expect(() => validateCountersOptions({ keyPrefix: 3 as unknown as string })).toThrow(InvalidCounterConfigError);
  });

  it('should validate keys, amounts, values, and TTLs with the source tag', () => {
    expect(() => validateCounterKey('k', 'get')).not.toThrow();
    expect(() => validateCounterKey('', 'get')).toThrow(/get: key/);
    expect(() => validateCounterKey(5, 'get')).toThrow(InvalidCounterConfigError);

    expect(() => validateCounterAmount(2, 'increment')).not.toThrow();
    expect(() => validateCounterAmount(-2, 'increment')).not.toThrow();
    expect(() => validateCounterAmount(0, 'increment')).toThrow(/increment: amount/);
    expect(() => validateCounterAmount(1.5, 'increment')).toThrow(InvalidCounterConfigError);
    expect(() => validateCounterAmount(Number.NaN, 'increment')).toThrow(/NaN/);

    expect(() => validateCounterValue(0, 'set')).not.toThrow();
    expect(() => validateCounterValue(1.5, 'set')).toThrow(InvalidCounterConfigError);

    expect(() => validateCounterTtl(undefined, 'set')).not.toThrow();
    expect(() => validateCounterTtl(1_000, 'set')).not.toThrow();
    expect(() => validateCounterTtl(0, 'set')).toThrow(InvalidCounterConfigError);
  });
});
