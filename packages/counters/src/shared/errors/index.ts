import { RedisXError, ErrorCode } from '@nestjs-redisx/core';

/**
 * Base error class for all counter errors.
 */
export class CounterError extends RedisXError {
  constructor(message: string, code: ErrorCode, cause?: Error, context?: Record<string, unknown>) {
    super(message, code, cause, context);
  }
}

/**
 * Error thrown on invalid plugin or per-call configuration (fail-fast).
 */
export class InvalidCounterConfigError extends CounterError {
  constructor(message: string) {
    super(message, ErrorCode.COUNTER_CONFIG_INVALID);
  }
}

/**
 * Error thrown when a counter key holds a non-numeric value — the key is
 * shared with something else, which is a wiring bug worth failing loudly on.
 */
export class CounterValueError extends CounterError {
  constructor(
    public readonly counterKey: string,
    public readonly rawValue: string,
  ) {
    super(`Counter "${counterKey}" holds a non-numeric value (${JSON.stringify(rawValue)}) — the key is not a counter`, ErrorCode.OP_TYPE_MISMATCH, undefined, { counterKey, rawValue });
  }
}
