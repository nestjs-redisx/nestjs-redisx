import { RedisXError, ErrorCode } from '@nestjs-redisx/core';

export class StreamError extends RedisXError {
  constructor(
    message: string,
    code: ErrorCode,
    public readonly stream?: string,
    cause?: Error,
  ) {
    super(message, code, cause, { stream });
  }
}

export class StreamPublishError extends StreamError {
  constructor(stream: string, cause?: Error) {
    super(`Failed to publish to stream "${stream}"`, ErrorCode.OP_FAILED, stream, cause);
  }
}

export class StreamConsumeError extends StreamError {
  constructor(stream: string, cause?: Error) {
    super(`Failed to consume from stream "${stream}"`, ErrorCode.STREAM_READ_FAILED, stream, cause);
  }
}

export class StreamGroupError extends StreamError {
  constructor(stream: string, group: string, cause?: Error) {
    super(`Failed to access group "${group}" on stream "${stream}"`, ErrorCode.STREAM_CONSUMER_GROUP_ERROR, stream, cause);
  }
}
