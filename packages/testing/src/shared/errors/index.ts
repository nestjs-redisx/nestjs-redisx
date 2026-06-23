import { RedisXError, ErrorCode } from '@nestjs-redisx/core';

/**
 * Base error for the in-memory testing driver.
 */
export class MemoryDriverError extends RedisXError {
  constructor(message: string, cause?: Error) {
    super(message, ErrorCode.OP_FAILED, cause);
    this.name = 'MemoryDriverError';
  }
}

/**
 * Thrown when a Lua script uses a construct or command the in-memory
 * interpreter does not support. Failing loudly prevents silent wrong results.
 */
export class LuaExecutionError extends MemoryDriverError {
  constructor(message: string, cause?: Error) {
    super(`Lua execution error: ${message}`, cause);
    this.name = 'LuaExecutionError';
  }
}

/**
 * Thrown when a command targets a key holding the wrong data type
 * (mirrors Redis WRONGTYPE).
 */
export class WrongTypeError extends MemoryDriverError {
  constructor() {
    super('WRONGTYPE Operation against a key holding the wrong kind of value');
    this.name = 'WrongTypeError';
  }
}
