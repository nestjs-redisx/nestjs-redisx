import { describe, it, expect } from 'vitest';
import { RedisXError, ErrorCode } from '@nestjs-redisx/core';

import { MemoryDriverError, LuaExecutionError, WrongTypeError } from '../../src/shared/errors';

/**
 * Unit tests for the in-memory driver error hierarchy.
 */
describe('testing errors', () => {
  it('MemoryDriverError extends RedisXError with OP_FAILED and a cause', () => {
    const cause = new Error('boom');
    const err = new MemoryDriverError('failed', cause);
    expect(err).toBeInstanceOf(RedisXError);
    expect(err.name).toBe('MemoryDriverError');
    expect(err.code).toBe(ErrorCode.OP_FAILED);
    expect(err.cause).toBe(cause);
    expect(err.message).toBe('failed');
  });

  it('LuaExecutionError prefixes the message and extends MemoryDriverError', () => {
    const err = new LuaExecutionError('bad token');
    expect(err).toBeInstanceOf(MemoryDriverError);
    expect(err.name).toBe('LuaExecutionError');
    expect(err.message).toBe('Lua execution error: bad token');
  });

  it('WrongTypeError mirrors the Redis WRONGTYPE message', () => {
    const err = new WrongTypeError();
    expect(err).toBeInstanceOf(MemoryDriverError);
    expect(err.name).toBe('WrongTypeError');
    expect(err.message).toContain('WRONGTYPE');
  });
});
