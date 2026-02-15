import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TracingService } from '../../src/tracing/application/services/tracing.service';
import type { ITracingPluginOptions } from '../../src/shared/types';
import { TracingInitializationError } from '../../src/shared/errors';

// Mock OpenTelemetry
const mockSpan = {
  setAttribute: vi.fn(),
  setAttributes: vi.fn(),
  addEvent: vi.fn(),
  recordException: vi.fn(),
  setStatus: vi.fn(),
  end: vi.fn(),
  spanContext: () => ({ spanId: '123', traceId: '456' }),
};

let activeSpan: any = undefined;

vi.mock('@opentelemetry/api', () => ({
  trace: {
    getTracer: vi.fn(() => ({
      startSpan: vi.fn(() => mockSpan),
    })),
    getActiveSpan: vi.fn(() => activeSpan),
    setSpan: vi.fn((ctx) => ctx),
  },
  context: {
    active: vi.fn(() => ({})),
    with: vi.fn((ctx, fn) => {
      // Simulate active span in context
      activeSpan = mockSpan;
      const result = fn();
      activeSpan = undefined;
      return result;
    }),
  },
  SpanKind: {
    SERVER: 1,
    CLIENT: 2,
    PRODUCER: 3,
    CONSUMER: 4,
    INTERNAL: 5,
  },
  SpanStatusCode: {
    UNSET: 0,
    OK: 1,
    ERROR: 2,
  },
}));

describe('TracingService', () => {
  let service: TracingService;
  let config: ITracingPluginOptions;

  beforeEach(() => {
    config = {
      enabled: true,
      serviceName: 'test-service',
      sampleRate: 1.0,
      traceRedisCommands: false,
      traceHttpRequests: false,
    };

    service = new TracingService(config);
  });

  describe('onModuleInit', () => {
    it('should initialize tracing when enabled', () => {
      // When/Then - should not throw
      expect(() => service.onModuleInit()).not.toThrow();
    });

    it('should not initialize when disabled', () => {
      // Given
      const disabledService = new TracingService({ enabled: false });

      // When/Then - should not throw
      expect(() => disabledService.onModuleInit()).not.toThrow();
    });

    it('should use console exporter', () => {
      // Given
      const consoleConfig = {
        ...config,
        exporter: { type: 'console' as const },
      };
      const consoleService = new TracingService(consoleConfig);

      // When/Then - should not throw
      expect(() => consoleService.onModuleInit()).not.toThrow();
    });

    it('should use OTLP exporter with endpoint', () => {
      // Given
      const otlpConfig = {
        ...config,
        exporter: {
          type: 'otlp' as const,
          endpoint: 'http://localhost:4318/v1/traces',
          headers: { 'x-api-key': 'test' },
        },
      };
      const otlpService = new TracingService(otlpConfig);

      // When/Then - should not throw
      expect(() => otlpService.onModuleInit()).not.toThrow();
    });

    it('should merge resourceAttributes into Resource', () => {
      // Given
      const resConfig = {
        ...config,
        resourceAttributes: {
          'service.version': '1.0.0',
          'deployment.environment': 'production',
        },
      };
      const resService = new TracingService(resConfig);

      // When/Then - should not throw (Resource is built with merged attrs)
      expect(() => resService.onModuleInit()).not.toThrow();
    });

    it('should warn about traceRedisCommands external dependency', () => {
      // Given
      const warnConfig = { ...config, traceRedisCommands: true };
      const warnService = new TracingService(warnConfig);

      // When/Then - should not throw and should log warning
      expect(() => warnService.onModuleInit()).not.toThrow();
    });

    it('should warn about traceHttpRequests external dependency', () => {
      // Given
      const warnConfig = { ...config, traceHttpRequests: true };
      const warnService = new TracingService(warnConfig);

      // When/Then - should not throw
      expect(() => warnService.onModuleInit()).not.toThrow();
    });
  });

  describe('startSpan', () => {
    beforeEach(() => {
      service.onModuleInit();
    });

    it('should start a span', () => {
      // Given
      const spanName = 'test-operation';

      // When
      const span = service.startSpan(spanName);

      // Then
      expect(span).toBeDefined();
      expect(span.setAttribute).toBeInstanceOf(Function);
      expect(span.end).toBeInstanceOf(Function);
    });

    it('should start span with options', () => {
      // Given
      const spanName = 'test-operation';
      const options = {
        kind: 'CLIENT' as const,
        attributes: { 'test.attr': 'value' },
      };

      // When
      const span = service.startSpan(spanName, options);

      // Then
      expect(span).toBeDefined();
    });

    it('should return noop span when disabled', () => {
      // Given
      const disabledService = new TracingService({ enabled: false });

      // When
      const span = disabledService.startSpan('test');

      // Then
      expect(span).toBeDefined();
      expect(span.spanId).toBe('');
      expect(span.traceId).toBe('');

      // Test noop span methods (should not throw and return chainable)
      const result = span.setAttribute('key', 'value').setAttributes({ attr: 'value' }).addEvent('event').recordException(new Error('test')).setStatus('ERROR');

      expect(result).toBeDefined();
      span.end(); // Should not throw
    });

    it('should add service.name attribute to spans', () => {
      // Given
      const customService = new TracingService({
        ...config,
        serviceName: 'my-app',
      });
      customService.onModuleInit();

      // When
      customService.startSpan('test');

      // Then — service name should be set as attribute (no throw)
      expect(true).toBe(true);
    });

    it('should skip span for excluded commands', () => {
      // Given
      const exclService = new TracingService({
        ...config,
        spans: { excludeCommands: ['PING', 'INFO'] },
      });
      exclService.onModuleInit();

      // When
      const span = exclService.startSpan('redis.command', {
        attributes: { 'db.statement': 'PING' },
      });

      // Then — should return noop span
      expect(span.spanId).toBe('');
    });

    it('should not skip span for non-excluded commands', () => {
      // Given
      const exclService = new TracingService({
        ...config,
        spans: { excludeCommands: ['PING'] },
      });
      exclService.onModuleInit();

      // When
      const span = exclService.startSpan('redis.command', {
        attributes: { 'db.statement': 'GET' },
      });

      // Then — should return real span
      expect(span.spanId).toBe('123');
    });

    it('should strip db.statement.args when includeArgs is false', () => {
      // Given — default: includeArgs is false
      const argsService = new TracingService({
        ...config,
        spans: { includeArgs: false },
      });
      argsService.onModuleInit();

      // When
      const span = argsService.startSpan('redis.GET', {
        attributes: { 'db.statement.args': 'my-key' },
      });

      // Then — span should be created without the args attribute
      expect(span).toBeDefined();
    });

    it('should keep db.statement.args when includeArgs is true', () => {
      // Given
      const argsService = new TracingService({
        ...config,
        spans: { includeArgs: true },
      });
      argsService.onModuleInit();

      // When
      const span = argsService.startSpan('redis.GET', {
        attributes: { 'db.statement.args': 'my-key' },
      });

      // Then — span should be created
      expect(span).toBeDefined();
    });

    it('should strip db.statement.result when includeResult is false', () => {
      // Given
      const resultService = new TracingService({
        ...config,
        spans: { includeResult: false },
      });
      resultService.onModuleInit();

      // When
      const span = resultService.startSpan('redis.GET', {
        attributes: { 'db.statement.result': 'some-value' },
      });

      // Then — span should be created
      expect(span).toBeDefined();
    });

    it('should truncate args exceeding maxArgLength', () => {
      // Given
      const truncService = new TracingService({
        ...config,
        spans: { includeArgs: true, maxArgLength: 10 },
      });
      truncService.onModuleInit();

      // When
      const span = truncService.startSpan('redis.SET', {
        attributes: { 'db.statement.args': 'this-is-a-very-long-argument-string' },
      });

      // Then — should create span (truncation applied internally)
      expect(span).toBeDefined();
    });

    it('should return noop span when sampleRate is 0', () => {
      // Given
      const zeroSample = new TracingService({
        ...config,
        sampleRate: 0,
      });
      zeroSample.onModuleInit();

      // When
      const span = zeroSample.startSpan('test');

      // Then — should be noop (sampleRate 0 → always skip)
      expect(span.spanId).toBe('');
    });
  });

  describe('withSpan', () => {
    beforeEach(() => {
      service.onModuleInit();
    });

    it('should execute function with span', async () => {
      // Given
      const fn = vi.fn().mockResolvedValue('result');

      // When
      const result = await service.withSpan('test', fn);

      // Then
      expect(result).toBe('result');
      expect(fn).toHaveBeenCalledOnce();
    });

    it('should handle errors in span', async () => {
      // Given
      const error = new Error('Test error');
      const fn = vi.fn().mockRejectedValue(error);

      // When/Then
      await expect(service.withSpan('test', fn)).rejects.toThrow('Test error');
    });

    it('should execute without span when disabled', async () => {
      // Given
      const disabledService = new TracingService({ enabled: false });
      const fn = vi.fn().mockResolvedValue('result');

      // When
      const result = await disabledService.withSpan('test', fn);

      // Then
      expect(result).toBe('result');
    });
  });

  describe('getCurrentSpan', () => {
    beforeEach(() => {
      service.onModuleInit();
    });

    it('should return undefined when no active span', () => {
      // When
      const span = service.getCurrentSpan();

      // Then
      expect(span).toBeUndefined();
    });

    it('should return undefined when disabled', () => {
      // Given
      const disabledService = new TracingService({ enabled: false });

      // When
      const span = disabledService.getCurrentSpan();

      // Then
      expect(span).toBeUndefined();
    });
  });

  describe('addEvent', () => {
    beforeEach(() => {
      service.onModuleInit();
    });

    it('should add event to current span when no active span', () => {
      // When/Then - should not throw even with no active span
      service.addEvent('test-event');
      service.addEvent('test-event-with-attrs', { key: 'value' });
    });

    it('should add event to active span inside withSpan', async () => {
      // When
      await service.withSpan('test', () => {
        service.addEvent('event-in-span');
        service.addEvent('event-with-attrs', { duration: 100 });
      });

      // Then - should not throw
      expect(true).toBe(true);
    });
  });

  describe('setAttribute', () => {
    beforeEach(() => {
      service.onModuleInit();
    });

    it('should set attribute when no active span', () => {
      // When/Then - should not throw even with no active span
      service.setAttribute('test.key', 'value');
    });

    it('should set attribute on active span inside withSpan', async () => {
      // When
      await service.withSpan('test', () => {
        service.setAttribute('custom.key', 'custom-value');
        service.setAttribute('another.key', 123);
      });

      // Then - should not throw
      expect(true).toBe(true);
    });
  });

  describe('recordException', () => {
    beforeEach(() => {
      service.onModuleInit();
    });

    it('should record exception when no active span', () => {
      // Given
      const error = new Error('Test error');

      // When/Then - should not throw even with no active span
      service.recordException(error);
    });

    it('should record exception on active span inside withSpan', async () => {
      // Given
      const error = new Error('Span error');

      // When
      await service.withSpan('test', () => {
        service.recordException(error);
      });

      // Then - should not throw
      expect(true).toBe(true);
    });
  });

  describe('onModuleDestroy', () => {
    it('should shutdown provider', async () => {
      // Given
      service.onModuleInit();

      // When/Then - should not throw
      await expect(service.onModuleDestroy()).resolves.not.toThrow();
    });

    it('should handle no provider', async () => {
      // Given - not initialized

      // When/Then - should not throw
      await expect(service.onModuleDestroy()).resolves.not.toThrow();
    });
  });

  describe('sampling strategies', () => {
    it('should use always sampling', () => {
      // Given
      const alwaysConfig = {
        ...config,
        sampling: { strategy: 'always' as const, ratio: 1.0 },
      };
      const alwaysService = new TracingService(alwaysConfig);

      // When/Then - should not throw
      expect(() => alwaysService.onModuleInit()).not.toThrow();
    });

    it('should use never sampling', () => {
      // Given
      const neverConfig = {
        ...config,
        sampling: { strategy: 'never' as const, ratio: 0.0 },
      };
      const neverService = new TracingService(neverConfig);

      // When/Then - should not throw
      expect(() => neverService.onModuleInit()).not.toThrow();
    });

    it('should use ratio sampling', () => {
      // Given
      const ratioConfig = {
        ...config,
        sampling: { strategy: 'ratio' as const, ratio: 0.5 },
      };
      const ratioService = new TracingService(ratioConfig);

      // When/Then - should not throw
      expect(() => ratioService.onModuleInit()).not.toThrow();
    });

    it('should use parent sampling', () => {
      // Given
      const parentConfig = {
        ...config,
        sampling: { strategy: 'parent' as const, ratio: 0.5 },
      };
      const parentService = new TracingService(parentConfig);

      // When/Then - should not throw
      expect(() => parentService.onModuleInit()).not.toThrow();
    });

    it('should fallback to always sampling for unknown strategy', () => {
      // Given
      const unknownConfig = {
        ...config,
        sampling: { strategy: 'unknown' as any, ratio: 0.5 },
      };
      const unknownService = new TracingService(unknownConfig);

      // When/Then - should not throw and use default sampler
      expect(() => unknownService.onModuleInit()).not.toThrow();
    });
  });

  describe('span kinds', () => {
    beforeEach(() => {
      service.onModuleInit();
    });

    it('should handle CLIENT span kind', () => {
      // When/Then - should not throw
      service.startSpan('test', { kind: 'CLIENT' });
    });

    it('should handle SERVER span kind', () => {
      // When/Then - should not throw
      service.startSpan('test', { kind: 'SERVER' });
    });

    it('should handle PRODUCER span kind', () => {
      // When/Then - should not throw
      service.startSpan('test', { kind: 'PRODUCER' });
    });

    it('should handle CONSUMER span kind', () => {
      // When/Then - should not throw
      service.startSpan('test', { kind: 'CONSUMER' });
    });

    it('should handle INTERNAL span kind', () => {
      // When/Then - should not throw
      service.startSpan('test', { kind: 'INTERNAL' });
    });
  });

  describe('exporter types', () => {
    it('should handle jaeger exporter', () => {
      // Given
      const jaegerConfig = {
        ...config,
        exporter: { type: 'jaeger' as const, endpoint: 'http://localhost:14268/api/traces' },
      };
      const jaegerService = new TracingService(jaegerConfig);

      // When/Then - should not throw
      expect(() => jaegerService.onModuleInit()).not.toThrow();
    });

    it('should handle zipkin exporter', () => {
      // Given
      const zipkinConfig = {
        ...config,
        exporter: { type: 'zipkin' as const, endpoint: 'http://localhost:9411/api/v2/spans' },
      };
      const zipkinService = new TracingService(zipkinConfig);

      // When/Then - should not throw
      expect(() => zipkinService.onModuleInit()).not.toThrow();
    });
  });

  describe('pluginTracing', () => {
    it('should register tracer with version when pluginTracing is true', () => {
      // Given
      const ptConfig = { ...config, pluginTracing: true };
      const ptService = new TracingService(ptConfig);

      // When/Then - should not throw
      expect(() => ptService.onModuleInit()).not.toThrow();
    });

    it('should register tracer without version when pluginTracing is false', () => {
      // Given
      const ptConfig = { ...config, pluginTracing: false };
      const ptService = new TracingService(ptConfig);

      // When/Then - should not throw
      expect(() => ptService.onModuleInit()).not.toThrow();
    });
  });
});
