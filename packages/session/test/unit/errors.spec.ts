import { describe, it, expect } from 'vitest';
import { RedisXError, ErrorCode } from '@nestjs-redisx/core';

import { SessionError, SessionStoreError, InvalidSessionConfigError, SessionLimitExceededError, SessionMiddlewareMissingError, SessionSerializationError } from '../../src/shared/errors';

describe('Session errors', () => {
  describe('SessionError', () => {
    it('should extend RedisXError and carry code, cause, and context', () => {
      // Given
      const cause = new Error('boom');

      // When
      const error = new SessionError('failed', ErrorCode.SESSION_STORE_ERROR, cause, { sessionId: 'abc' });

      // Then
      expect(error).toBeInstanceOf(RedisXError);
      expect(error).toBeInstanceOf(SessionError);
      expect(error.name).toBe('SessionError');
      expect(error.code).toBe(ErrorCode.SESSION_STORE_ERROR);
      expect(error.cause).toBe(cause);
      expect(error.context).toEqual({ sessionId: 'abc' });
    });

    it('should serialize to JSON with name, message, and code', () => {
      // Given
      const error = new SessionError('failed', ErrorCode.SESSION_STORE_ERROR);

      // When
      const json = error.toJSON();

      // Then
      expect(json.name).toBe('SessionError');
      expect(json.message).toBe('failed');
      expect(json.code).toBe(ErrorCode.SESSION_STORE_ERROR);
    });
  });

  describe('SessionStoreError', () => {
    it('should use SESSION_STORE_ERROR code and wrap the cause', () => {
      // Given
      const cause = new Error('redis down');

      // When
      const error = new SessionStoreError('get failed', cause);

      // Then
      expect(error).toBeInstanceOf(SessionError);
      expect(error.code).toBe(ErrorCode.SESSION_STORE_ERROR);
      expect(error.message).toBe('get failed');
      expect(error.cause).toBe(cause);
    });
  });

  describe('InvalidSessionConfigError', () => {
    it('should use SESSION_CONFIG_INVALID code', () => {
      // When
      const error = new InvalidSessionConfigError('defaultTtlMs must be a positive integer');

      // Then
      expect(error).toBeInstanceOf(SessionError);
      expect(error.code).toBe(ErrorCode.SESSION_CONFIG_INVALID);
      expect(error.message).toContain('defaultTtlMs');
    });
  });

  describe('SessionLimitExceededError', () => {
    it('should expose userId and maxSessions and use SESSION_LIMIT_EXCEEDED code', () => {
      // When
      const error = new SessionLimitExceededError('user-1', 3);

      // Then
      expect(error).toBeInstanceOf(SessionError);
      expect(error.code).toBe(ErrorCode.SESSION_LIMIT_EXCEEDED);
      expect(error.userId).toBe('user-1');
      expect(error.maxSessions).toBe(3);
      expect(error.message).toContain('user-1');
      expect(error.message).toContain('3');
      expect(error.context).toEqual({ userId: 'user-1', maxSessions: 3 });
    });
  });

  describe('SessionMiddlewareMissingError', () => {
    it('should name the missing package and use SESSION_MIDDLEWARE_MISSING code', () => {
      // Given
      const cause = new Error('Cannot find module');

      // When
      const error = new SessionMiddlewareMissingError('express-session', cause);

      // Then
      expect(error).toBeInstanceOf(SessionError);
      expect(error.code).toBe(ErrorCode.SESSION_MIDDLEWARE_MISSING);
      expect(error.message).toContain('express-session');
      expect(error.message).toContain('npm install');
      expect(error.cause).toBe(cause);
    });
  });

  describe('SessionSerializationError', () => {
    it('should carry the session id and use SESSION_SERIALIZATION_FAILED code', () => {
      // Given
      const cause = new Error('circular structure');

      // When
      const error = new SessionSerializationError('sid-1', cause);

      // Then
      expect(error).toBeInstanceOf(SessionError);
      expect(error.code).toBe(ErrorCode.SESSION_SERIALIZATION_FAILED);
      expect(error.message).toContain('sid-1');
      expect(error.cause).toBe(cause);
      expect(error.context).toEqual({ sessionId: 'sid-1' });
    });
  });
});
