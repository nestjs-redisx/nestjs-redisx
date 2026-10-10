import { describe, it, expect } from 'vitest';
import { RedisXError, ErrorCode } from '@nestjs-redisx/core';
import { CounterError, InvalidCounterConfigError, CounterValueError } from '../../src/shared/errors';

describe('counter errors', () => {
  it('should build the hierarchy on RedisXError with counter codes', () => {
    const config = new InvalidCounterConfigError('bad');
    const value = new CounterValueError('k', 'oops');

    expect(config).toBeInstanceOf(CounterError);
    expect(config).toBeInstanceOf(RedisXError);
    expect(value).toBeInstanceOf(CounterError);
    expect(config.code).toBe(ErrorCode.COUNTER_CONFIG_INVALID);
    expect(value.code).toBe(ErrorCode.OP_TYPE_MISMATCH);
  });

  it('should carry the key and raw value on value errors (toJSON included)', () => {
    const error = new CounterValueError('stats', 'hello');
    expect(error.counterKey).toBe('stats');
    expect(error.rawValue).toBe('hello');
    expect(error.message).toContain('stats');
    const json = error.toJSON() as Record<string, unknown>;
    expect((json.context as Record<string, unknown>).counterKey).toBe('stats');
  });
});
