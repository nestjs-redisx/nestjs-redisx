import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SpanWrapper } from '../../src/tracing/domain/value-objects/span-wrapper.vo';
import type { Span } from '@opentelemetry/api';

describe('SpanWrapper', () => {
  let mockSpan: Span;
  let wrapper: SpanWrapper;

  beforeEach(() => {
    mockSpan = {
      spanContext: vi.fn().mockReturnValue({
        spanId: 'test-span-id',
        traceId: 'test-trace-id',
      }),
      setAttribute: vi.fn().mockReturnThis(),
      setAttributes: vi.fn().mockReturnThis(),
      addEvent: vi.fn().mockReturnThis(),
      recordException: vi.fn().mockReturnThis(),
      setStatus: vi.fn().mockReturnThis(),
      end: vi.fn(),
      isRecording: vi.fn().mockReturnValue(true),
      updateName: vi.fn().mockReturnThis(),
    } as unknown as Span;

    wrapper = new SpanWrapper(mockSpan);
  });

  describe('spanId', () => {
    it('should return span ID from context', () => {
      // When
      const spanId = wrapper.spanId;

      // Then
      expect(spanId).toBe('test-span-id');
      expect(mockSpan.spanContext).toHaveBeenCalled();
    });
  });

  describe('traceId', () => {
    it('should return trace ID from context', () => {
      // When
      const traceId = wrapper.traceId;

      // Then
      expect(traceId).toBe('test-trace-id');
      expect(mockSpan.spanContext).toHaveBeenCalled();
    });
  });

  describe('setAttribute', () => {
    it('should set attribute on underlying span', () => {
      // Given
      const key = 'http.method';
      const value = 'GET';

      // When
      const result = wrapper.setAttribute(key, value);

      // Then
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(key, value);
      expect(result).toBe(wrapper);
    });

    it('should support fluent API', () => {
      // When
      const result = wrapper.setAttribute('key1', 'value1').setAttribute('key2', 'value2');

      // Then
      expect(mockSpan.setAttribute).toHaveBeenCalledTimes(2);
      expect(result).toBe(wrapper);
    });

    it('should handle different attribute types', () => {
      // When
      wrapper.setAttribute('string.attr', 'value');
      wrapper.setAttribute('number.attr', 42);
      wrapper.setAttribute('boolean.attr', true);

      // Then
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('string.attr', 'value');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('number.attr', 42);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('boolean.attr', true);
    });
  });

  describe('setAttributes', () => {
    it('should set multiple attributes on underlying span', () => {
      // Given
      const attributes = {
        'http.method': 'POST',
        'http.status_code': 201,
        'http.url': 'https://api.example.com',
      };

      // When
      const result = wrapper.setAttributes(attributes);

      // Then
      expect(mockSpan.setAttributes).toHaveBeenCalledWith(attributes);
      expect(result).toBe(wrapper);
    });

    it('should support fluent API', () => {
      // When
      const result = wrapper.setAttributes({ key1: 'value1' }).setAttributes({ key2: 'value2' });

      // Then
      expect(mockSpan.setAttributes).toHaveBeenCalledTimes(2);
      expect(result).toBe(wrapper);
    });

    it('should handle empty attributes object', () => {
      // When
      wrapper.setAttributes({});

      // Then
      expect(mockSpan.setAttributes).toHaveBeenCalledWith({});
    });
  });

  describe('addEvent', () => {
    it('should add event without attributes', () => {
      // Given
      const eventName = 'cache.hit';

      // When
      const result = wrapper.addEvent(eventName);

      // Then
      expect(mockSpan.addEvent).toHaveBeenCalledWith(eventName, undefined);
      expect(result).toBe(wrapper);
    });

    it('should add event with attributes', () => {
      // Given
      const eventName = 'error.occurred';
      const attributes = { error: 'Connection timeout', code: 500 };

      // When
      const result = wrapper.addEvent(eventName, attributes);

      // Then
      expect(mockSpan.addEvent).toHaveBeenCalledWith(eventName, attributes);
      expect(result).toBe(wrapper);
    });

    it('should support fluent API', () => {
      // When
      const result = wrapper.addEvent('event1').addEvent('event2', { key: 'value' });

      // Then
      expect(mockSpan.addEvent).toHaveBeenCalledTimes(2);
      expect(result).toBe(wrapper);
    });
  });

  describe('recordException', () => {
    it('should record exception on underlying span', () => {
      // Given
      const error = new Error('Test error');

      // When
      const result = wrapper.recordException(error);

      // Then
      expect(mockSpan.recordException).toHaveBeenCalledWith(error);
      expect(result).toBe(wrapper);
    });

    it('should support fluent API', () => {
      // Given
      const error1 = new Error('Error 1');
      const error2 = new Error('Error 2');

      // When
      const result = wrapper.recordException(error1).recordException(error2);

      // Then
      expect(mockSpan.recordException).toHaveBeenCalledTimes(2);
      expect(result).toBe(wrapper);
    });

    it('should handle different error types', () => {
      // Given
      const standardError = new Error('Standard error');
      const customError = new TypeError('Type error');

      // When
      wrapper.recordException(standardError);
      wrapper.recordException(customError);

      // Then
      expect(mockSpan.recordException).toHaveBeenCalledWith(standardError);
      expect(mockSpan.recordException).toHaveBeenCalledWith(customError);
    });
  });

  describe('setStatus', () => {
    it('should set OK status', () => {
      // When
      const result = wrapper.setStatus('OK');

      // Then
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 1 }); // SpanStatusCode.OK = 1
      expect(result).toBe(wrapper);
    });

    it('should set ERROR status', () => {
      // When
      const result = wrapper.setStatus('ERROR');

      // Then
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 2 }); // SpanStatusCode.ERROR = 2
      expect(result).toBe(wrapper);
    });

    it('should support fluent API', () => {
      // When
      const result = wrapper.setStatus('OK').setAttribute('key', 'value');

      // Then
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 1 });
      expect(result).toBe(wrapper);
    });
  });

  describe('end', () => {
    it('should end the underlying span', () => {
      // When
      wrapper.end();

      // Then
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should allow ending span multiple times', () => {
      // When
      wrapper.end();
      wrapper.end();

      // Then
      expect(mockSpan.end).toHaveBeenCalledTimes(2);
    });
  });

  describe('unwrap', () => {
    it('should return underlying span', () => {
      // When
      const result = wrapper.unwrap();

      // Then
      expect(result).toBe(mockSpan);
    });

    it('should allow access to native span methods', () => {
      // When
      const nativeSpan = wrapper.unwrap();
      nativeSpan.isRecording();

      // Then
      expect(mockSpan.isRecording).toHaveBeenCalled();
    });
  });

  describe('fluent API integration', () => {
    it('should chain multiple operations', () => {
      // Given
      const error = new Error('Test error');

      // When
      const result = wrapper.setAttribute('operation', 'database.query').setAttributes({ 'db.name': 'users', 'db.operation': 'select' }).addEvent('query.start').addEvent('query.end', { duration: 42 }).recordException(error).setStatus('ERROR');

      // Then
      expect(result).toBe(wrapper);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('operation', 'database.query');
      expect(mockSpan.setAttributes).toHaveBeenCalledWith({ 'db.name': 'users', 'db.operation': 'select' });
      expect(mockSpan.addEvent).toHaveBeenCalledWith('query.start', undefined);
      expect(mockSpan.addEvent).toHaveBeenCalledWith('query.end', { duration: 42 });
      expect(mockSpan.recordException).toHaveBeenCalledWith(error);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 2 }); // SpanStatusCode.ERROR = 2
    });
  });
});
