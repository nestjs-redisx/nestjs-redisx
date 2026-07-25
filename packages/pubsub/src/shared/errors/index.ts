import { RedisXError, ErrorCode } from '@nestjs-redisx/core';

/**
 * Base error class for Pub/Sub errors.
 */
export class PubSubError extends RedisXError {
  constructor(message: string, code: ErrorCode, cause?: Error, context?: Record<string, unknown>) {
    super(message, code, cause, context);
  }
}

/**
 * Error thrown when publishing a message fails (serialization or transport).
 */
export class PubSubPublishError extends PubSubError {
  constructor(channel: string, cause?: Error) {
    super(`Failed to publish to channel "${channel}"${cause ? `: ${cause.message}` : ''}`, ErrorCode.PUBSUB_PUBLISH_FAILED, cause, { channel });
  }
}

/**
 * Error thrown when subscribing to a channel or pattern fails.
 */
export class PubSubSubscribeError extends PubSubError {
  constructor(target: string, cause?: Error) {
    super(`Failed to subscribe to "${target}"${cause ? `: ${cause.message}` : ''}`, ErrorCode.PUBSUB_SUBSCRIBE_FAILED, cause, { target });
  }
}
