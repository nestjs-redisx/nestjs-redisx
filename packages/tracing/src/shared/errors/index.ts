import { RedisXError, ErrorCode } from '@nestjs-redisx/core';

export class TracingError extends RedisXError {
  constructor(message: string, cause?: Error) {
    super(message, ErrorCode.OP_FAILED, cause);
  }
}

export class TracingInitializationError extends TracingError {
  constructor(cause?: Error) {
    super('Failed to initialize tracing provider', cause);
  }
}

export class SpanCreationError extends TracingError {
  constructor(spanName: string, cause?: Error) {
    super(`Failed to create span "${spanName}"`, cause);
  }
}
