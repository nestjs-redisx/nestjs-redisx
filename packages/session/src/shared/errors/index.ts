import { RedisXError, ErrorCode } from '@nestjs-redisx/core';

/**
 * Base error class for session errors.
 */
export class SessionError extends RedisXError {
  constructor(message: string, code: ErrorCode, cause?: Error, context?: Record<string, unknown>) {
    super(message, code, cause, context);
  }
}

/**
 * Error thrown when a session store operation fails (e.g. Redis/Lua error).
 */
export class SessionStoreError extends SessionError {
  constructor(message: string, cause?: Error) {
    super(message, ErrorCode.SESSION_STORE_ERROR, cause);
  }
}

/**
 * Error thrown when the session plugin configuration is invalid.
 */
export class InvalidSessionConfigError extends SessionError {
  constructor(message: string) {
    super(message, ErrorCode.SESSION_CONFIG_INVALID);
  }
}

/**
 * Error thrown when a new session would exceed `maxSessionsPerUser`
 * under the `reject` policy. Surfaces through the middleware's save/logIn
 * callback so the application can respond (e.g. HTTP 409).
 */
export class SessionLimitExceededError extends SessionError {
  constructor(
    public readonly userId: string,
    public readonly maxSessions: number,
  ) {
    super(`Session limit exceeded for user "${userId}": at most ${maxSessions} concurrent sessions allowed`, ErrorCode.SESSION_LIMIT_EXCEEDED, undefined, { userId, maxSessions });
  }
}

/**
 * Error thrown when an optional session middleware package is required but
 * not installed (e.g. building an express store without `express-session`).
 */
export class SessionMiddlewareMissingError extends SessionError {
  constructor(packageName: string, cause?: Error) {
    super(`Package "${packageName}" is required for this adapter but is not installed. Run: npm install ${packageName}`, ErrorCode.SESSION_MIDDLEWARE_MISSING, cause, { packageName });
  }
}

/**
 * Error thrown when a session payload cannot be serialized to JSON.
 * (Corrupt stored payloads are self-healed: destroyed and treated as a miss.)
 */
export class SessionSerializationError extends SessionError {
  constructor(sessionId: string, cause?: Error) {
    super(`Failed to serialize session "${sessionId}" payload to JSON`, ErrorCode.SESSION_SERIALIZATION_FAILED, cause, { sessionId });
  }
}
