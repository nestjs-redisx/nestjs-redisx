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

  it('should reject non-object options with a source-tagged error instead of a bare TypeError', () => {
    // When/Then - a registerAsync factory returning undefined (missing
    // config key) and a JS caller passing null are the classic shapes
    expect(() => validateLeaderOptions(undefined as never, 'test')).toThrow(InvalidLeaderConfigError);
    expect(() => validateLeaderOptions(null as never, 'test')).toThrow(InvalidLeaderConfigError);
    expect(() => validateLeaderOptions('config' as never, 'test')).toThrow(InvalidLeaderConfigError);
    // An accidentally list-wrapped config would otherwise pass every check
    // (all property reads yield undefined) and silently boot with defaults
    expect(() => validateLeaderOptions([{ ttlMs: 30_000 }] as never, 'test')).toThrow(InvalidLeaderConfigError);
  });

  it('should reject a thenable (un-awaited async config) instead of silently booting all-defaults', () => {
    // Given - `new LeaderPlugin(loadConfig())` with an async loader: a
    // Promise has zero own enumerable keys, so every per-key check passes
    const pending = Promise.resolve({ ttlMs: 30_000 });

    // When/Then - the error points at the two correct alternatives
    expect(() => validateLeaderOptions(pending as never, 'test')).toThrow(InvalidLeaderConfigError);
    expect(() => validateLeaderOptions(pending as never, 'test')).toThrow(/registerAsync/);
    // A `then` that is not callable is just a widened key, not a thenable
    expect(() => validateLeaderOptions({ then: 'not-a-function' } as never, 'test')).not.toThrow();
  });

  it('should reject BigInt inputs with the source-tagged error - the message template must not die on JSON.stringify', () => {
    // When/Then - plausible from process.hrtime.bigint() arithmetic in JS;
    // JSON.stringify(BigInt) throws, which would replace the tagged config
    // error with a bare TypeError from inside the guard itself
    expect(() => validateLeaderOptions({ ttlMs: 10_000n as never }, 'test')).toThrow(InvalidLeaderConfigError);
    expect(() => validateLeaderOptions({ ttlMs: 10_000n as never }, 'test')).toThrow(/10000n/);
    // Group names reach the same template through validateLeaderGroup
    expect(() => validateLeaderOptions({ groups: [1n as never] }, 'test')).toThrow(InvalidLeaderConfigError);
    // Symbol goes through the same describe path (stringify yields undefined)
    expect(() => validateLeaderOptions({ ttlMs: Symbol('ttl') as never }, 'test')).toThrow(InvalidLeaderConfigError);
  });

  it('should describe non-finite numbers truthfully - JSON.stringify renders NaN/Infinity as "null", pointing the operator at a null that never existed', () => {
    // Given - the canonical env accident: parseInt of an unset variable
    // When/Then
    expect(() => validateLeaderOptions({ ttlMs: Number.NaN }, 'test')).toThrow(/got NaN/);
    expect(() => validateLeaderOptions({ ttlMs: Number.POSITIVE_INFINITY }, 'test')).toThrow(/got Infinity/);
    expect(() => validateLeaderOptions({ renewIntervalMs: Number.NEGATIVE_INFINITY }, 'test')).toThrow(/got -Infinity/);
  });

  it('should keep the tagged error when the value defeats JSON.stringify (circular structure or throwing toJSON)', () => {
    // Given - framework objects in the group position are circular by
    // construction (Express req, socket-bearing jobs)
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const boom = {
      toJSON: () => {
        throw new Error('user toJSON boom');
      },
    };

    // When/Then - the guard's own throw path must stay source-tagged
    expect(() => validateLeaderOptions({ groups: [circular as never] }, 'test')).toThrow(InvalidLeaderConfigError);
    expect(() => validateLeaderOptions({ ttlMs: boom as never }, 'test')).toThrow(InvalidLeaderConfigError);
  });

  it('should reject non-function lifecycle callbacks - a dead callback would only surface as a contained warn on the winning pod', () => {
    // When/Then
    expect(() => validateLeaderOptions({ onElected: 'notifyOps' as never }, 'test')).toThrow(InvalidLeaderConfigError);
    expect(() => validateLeaderOptions({ onLost: { handler: true } as never }, 'test')).toThrow(InvalidLeaderConfigError);
    expect(() => validateLeaderOptions({ onElected: () => undefined, onLost: async () => undefined }, 'test')).not.toThrow();
  });

  it('should reject durations beyond the JS timer range (setTimeout clamps larger delays to 1 ms - a hot loop)', () => {
    // When/Then - 2^31 ms is one past the setTimeout cap
    expect(() => validateLeaderOptions({ ttlMs: 2 ** 31 }, 'test')).toThrow(InvalidLeaderConfigError);
    // A "re-elect monthly" misconfiguration: 45d ttl, 30d heartbeat - would
    // previously pass validation and then tick every ~1 ms at runtime
    expect(() => validateLeaderOptions({ ttlMs: 45 * 24 * 60 * 60 * 1000, renewIntervalMs: 30 * 24 * 60 * 60 * 1000 }, 'test')).toThrow(InvalidLeaderConfigError);
    // The cap itself is a valid value
    expect(() => validateLeaderOptions({ ttlMs: 2 ** 31 - 1, renewIntervalMs: 5_000 }, 'test')).not.toThrow();
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
    // Given - default ttl is 15000
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

  it('should reject an empty or non-string keyPrefix', () => {
    // When/Then - an empty prefix makes the election key a bare group name
    expect(() => validateLeaderOptions({ keyPrefix: '' }, 'test')).toThrow(InvalidLeaderConfigError);
    expect(() => validateLeaderOptions({ keyPrefix: 42 as never }, 'test')).toThrow(InvalidLeaderConfigError);
    expect(() => validateLeaderOptions({ keyPrefix: 'leader:' }, 'test')).not.toThrow();
  });

  it('should include the source in the error message', () => {
    // When/Then
    expect(() => validateLeaderOptions({ ttlMs: 0 }, 'LeaderPlugin options')).toThrow(/LeaderPlugin options/);
  });
});
