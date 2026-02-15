import { RedisXError, ErrorCode } from '@nestjs-redisx/core';

export class MetricsError extends RedisXError {
  constructor(message: string, cause?: Error) {
    super(message, ErrorCode.OP_FAILED, cause);
  }
}

export class MetricRegistrationError extends MetricsError {
  constructor(metricName: string, cause?: Error) {
    super(`Failed to register metric "${metricName}"`, cause);
  }
}
