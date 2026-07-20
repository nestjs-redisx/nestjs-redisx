import { RedisXError, ErrorCode } from '@nestjs-redisx/core';

import { ICircuitSnapshot } from '../../domain/circuit-breaker-state.interface';

/**
 * Base error class for circuit breaker errors.
 */
export class CircuitBreakerError extends RedisXError {
  constructor(message: string, code: ErrorCode, cause?: Error, context?: Record<string, unknown>) {
    super(message, code, cause, context);
  }
}

/**
 * Error thrown when the circuit breaker is OPEN (or its half-open probe budget
 * is exhausted) and the guarded call is rejected without being executed.
 */
export class CircuitBreakerOpenError extends CircuitBreakerError {
  constructor(
    public readonly key: string,
    public readonly circuitSnapshot: ICircuitSnapshot,
  ) {
    super(`Circuit breaker "${key}" is ${circuitSnapshot.state}; call rejected`, ErrorCode.CIRCUIT_BREAKER_OPEN, undefined, { key, state: circuitSnapshot.state });
  }
}

/**
 * Error thrown when the circuit breaker state store fails (e.g. Redis/Lua error).
 */
export class CircuitBreakerStoreError extends CircuitBreakerError {
  constructor(message: string, cause?: Error) {
    super(message, ErrorCode.CIRCUIT_BREAKER_STORE_ERROR, cause);
  }
}

/**
 * Error thrown when the circuit breaker configuration is invalid.
 */
export class InvalidCircuitBreakerConfigError extends CircuitBreakerError {
  constructor(message: string) {
    super(message, ErrorCode.CIRCUIT_BREAKER_CONFIG_INVALID);
  }
}
