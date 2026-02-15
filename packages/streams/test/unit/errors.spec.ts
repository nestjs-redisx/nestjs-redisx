import { describe, it, expect } from 'vitest';
import { ErrorCode } from '@nestjs-redisx/core';
import { StreamError, StreamPublishError, StreamConsumeError, StreamGroupError } from '../../src/shared/errors';

describe('Stream Errors', () => {
  describe('StreamError', () => {
    it('should create error with stream name', () => {
      // Given
      const message = 'Stream error';
      const stream = 'mystream';

      // When
      const error = new StreamError(message, ErrorCode.OP_FAILED, stream);

      // Then
      expect(error).toBeInstanceOf(StreamError);
      expect(error.message).toBe(message);
      expect(error.stream).toBe(stream);
      expect(error.code).toBe(ErrorCode.OP_FAILED);
    });

    it('should create error with cause', () => {
      // Given
      const cause = new Error('Original error');
      const message = 'Stream error';
      const stream = 'mystream';

      // When
      const error = new StreamError(message, ErrorCode.OP_FAILED, stream, cause);

      // Then
      expect(error.cause).toBe(cause);
    });

    it('should create error without stream', () => {
      // Given
      const message = 'Generic stream error';

      // When
      const error = new StreamError(message, ErrorCode.OP_FAILED);

      // Then
      expect(error.message).toBe(message);
      expect(error.stream).toBeUndefined();
    });
  });

  describe('StreamPublishError', () => {
    it('should create publish error', () => {
      // Given
      const stream = 'orders';

      // When
      const error = new StreamPublishError(stream);

      // Then
      expect(error).toBeInstanceOf(StreamPublishError);
      expect(error.message).toContain('Failed to publish');
      expect(error.message).toContain(stream);
      expect(error.stream).toBe(stream);
      expect(error.code).toBe(ErrorCode.OP_FAILED);
    });

    it('should create publish error with cause', () => {
      // Given
      const stream = 'events';
      const cause = new Error('Connection lost');

      // When
      const error = new StreamPublishError(stream, cause);

      // Then
      expect(error.cause).toBe(cause);
      expect(error.stream).toBe(stream);
    });
  });

  describe('StreamConsumeError', () => {
    it('should create consume error', () => {
      // Given
      const stream = 'notifications';

      // When
      const error = new StreamConsumeError(stream);

      // Then
      expect(error).toBeInstanceOf(StreamConsumeError);
      expect(error.message).toContain('Failed to consume');
      expect(error.message).toContain(stream);
      expect(error.stream).toBe(stream);
      expect(error.code).toBe(ErrorCode.STREAM_READ_FAILED);
    });

    it('should create consume error with cause', () => {
      // Given
      const stream = 'logs';
      const cause = new Error('Timeout');

      // When
      const error = new StreamConsumeError(stream, cause);

      // Then
      expect(error.cause).toBe(cause);
      expect(error.stream).toBe(stream);
    });
  });

  describe('StreamGroupError', () => {
    it('should create group error', () => {
      // Given
      const stream = 'tasks';
      const group = 'workers';

      // When
      const error = new StreamGroupError(stream, group);

      // Then
      expect(error).toBeInstanceOf(StreamGroupError);
      expect(error.message).toContain('Failed to access group');
      expect(error.message).toContain(group);
      expect(error.message).toContain(stream);
      expect(error.stream).toBe(stream);
      expect(error.code).toBe(ErrorCode.STREAM_CONSUMER_GROUP_ERROR);
    });

    it('should create group error with cause', () => {
      // Given
      const stream = 'events';
      const group = 'processors';
      const cause = new Error('Group does not exist');

      // When
      const error = new StreamGroupError(stream, group, cause);

      // Then
      expect(error.cause).toBe(cause);
      expect(error.stream).toBe(stream);
    });
  });
});
