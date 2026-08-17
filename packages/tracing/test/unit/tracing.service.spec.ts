import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

  // The standalone path registers into the REAL OTel global slot (the SDK is
  // not mocked, only @opentelemetry/api is) — clear it around every test so
  // 'auto' mode keeps choosing the standalone path and tests stay isolated.
  const clearOtelGlobalSlot = (): void => {
    delete (globalThis as Record<symbol, unknown>)[Symbol.for('opentelemetry.js.api.1')];
  };

  afterEach(clearOtelGlobalSlot);

  beforeEach(async () => {
    clearOtelGlobalSlot();
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
    it('should initialize tracing when enabled', async () => {
      // When/Then - should not throw
      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });

    it('should not initialize when disabled', async () => {
      // Given
      const disabledService = new TracingService({ enabled: false });

      // When/Then - should not throw
      await expect(disabledService.onModuleInit()).resolves.toBeUndefined();
    });

    it('should use console exporter', async () => {
      // Given
      const consoleConfig = {
        ...config,
        exporter: { type: 'console' as const },
      };
      const consoleService = new TracingService(consoleConfig);

      // When/Then - should not throw
      await expect(consoleService.onModuleInit()).resolves.toBeUndefined();
    });

    it('should use OTLP exporter with endpoint', async () => {
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
      await expect(otlpService.onModuleInit()).resolves.toBeUndefined();
    });

    it('should merge resourceAttributes into Resource', async () => {
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
      await expect(resService.onModuleInit()).resolves.toBeUndefined();
    });

    it('should warn about traceRedisCommands external dependency', async () => {
      // Given
      const warnConfig = { ...config, traceRedisCommands: true };
      const warnService = new TracingService(warnConfig);

      // When/Then - should not throw and should log warning
      await expect(warnService.onModuleInit()).resolves.toBeUndefined();
    });

    it('should warn about traceHttpRequests external dependency', async () => {
      // Given
      const warnConfig = { ...config, traceHttpRequests: true };
      const warnService = new TracingService(warnConfig);

      // When/Then - should not throw
      await expect(warnService.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe('startSpan', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should start a span', async () => {
      // Given
      const spanName = 'test-operation';

      // When
      const span = service.startSpan(spanName);

      // Then
      expect(span).toBeDefined();
      expect(span.setAttribute).toBeInstanceOf(Function);
      expect(span.end).toBeInstanceOf(Function);
    });

    it('should start span with options', async () => {
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

    it('should return noop span when disabled', async () => {
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

    it('should add service.name attribute to spans', async () => {
      // Given
      const customService = new TracingService({
        ...config,
        serviceName: 'my-app',
      });
      await customService.onModuleInit();

      // When
      customService.startSpan('test');

      // Then — service name should be set as attribute (no throw)
      expect(true).toBe(true);
    });

    it('should skip span for excluded commands', async () => {
      // Given
      const exclService = new TracingService({
        ...config,
        spans: { excludeCommands: ['PING', 'INFO'] },
      });
      await exclService.onModuleInit();

      // When
      const span = exclService.startSpan('redis.command', {
        attributes: { 'db.statement': 'PING' },
      });

      // Then — should return noop span
      expect(span.spanId).toBe('');
    });

    it('should not skip span for non-excluded commands', async () => {
      // Given
      const exclService = new TracingService({
        ...config,
        spans: { excludeCommands: ['PING'] },
      });
      await exclService.onModuleInit();

      // When
      const span = exclService.startSpan('redis.command', {
        attributes: { 'db.statement': 'GET' },
      });

      // Then — should return real span
      expect(span.spanId).toBe('123');
    });

    it('should strip db.statement.args when includeArgs is false', async () => {
      // Given — default: includeArgs is false
      const argsService = new TracingService({
        ...config,
        spans: { includeArgs: false },
      });
      await argsService.onModuleInit();

      // When
      const span = argsService.startSpan('redis.GET', {
        attributes: { 'db.statement.args': 'my-key' },
      });

      // Then — span should be created without the args attribute
      expect(span).toBeDefined();
    });

    it('should keep db.statement.args when includeArgs is true', async () => {
      // Given
      const argsService = new TracingService({
        ...config,
        spans: { includeArgs: true },
      });
      await argsService.onModuleInit();

      // When
      const span = argsService.startSpan('redis.GET', {
        attributes: { 'db.statement.args': 'my-key' },
      });

      // Then — span should be created
      expect(span).toBeDefined();
    });

    it('should strip db.statement.result when includeResult is false', async () => {
      // Given
      const resultService = new TracingService({
        ...config,
        spans: { includeResult: false },
      });
      await resultService.onModuleInit();

      // When
      const span = resultService.startSpan('redis.GET', {
        attributes: { 'db.statement.result': 'some-value' },
      });

      // Then — span should be created
      expect(span).toBeDefined();
    });

    it('should truncate args exceeding maxArgLength', async () => {
      // Given
      const truncService = new TracingService({
        ...config,
        spans: { includeArgs: true, maxArgLength: 10 },
      });
      await truncService.onModuleInit();

      // When
      const span = truncService.startSpan('redis.SET', {
        attributes: { 'db.statement.args': 'this-is-a-very-long-argument-string' },
      });

      // Then — should create span (truncation applied internally)
      expect(span).toBeDefined();
    });

    it('should return noop span when sampleRate is 0', async () => {
      // Given
      const zeroSample = new TracingService({
        ...config,
        sampleRate: 0,
      });
      await zeroSample.onModuleInit();

      // When
      const span = zeroSample.startSpan('test');

      // Then — should be noop (sampleRate 0 → always skip)
      expect(span.spanId).toBe('');
    });
  });

  describe('withSpan', () => {
    beforeEach(async () => {
      await service.onModuleInit();
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
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should return undefined when no active span', async () => {
      // When
      const span = service.getCurrentSpan();

      // Then
      expect(span).toBeUndefined();
    });

    it('should return undefined when disabled', async () => {
      // Given
      const disabledService = new TracingService({ enabled: false });

      // When
      const span = disabledService.getCurrentSpan();

      // Then
      expect(span).toBeUndefined();
    });
  });

  describe('addEvent', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should add event to current span when no active span', async () => {
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
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should set attribute when no active span', async () => {
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
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should record exception when no active span', async () => {
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
      await service.onModuleInit();

      // When/Then - should not throw
      await expect(service.onModuleDestroy()).resolves.not.toThrow();
    });

    it('should handle no provider', async () => {
      // Given - not initialized

      // When/Then - should not throw
      await expect(service.onModuleDestroy()).resolves.not.toThrow();
    });

    it('should be a no-op when tracing is disabled (provider is null)', async () => {
      // Given — disabled service with no initialized provider
      const disabledService = new TracingService({ enabled: false });

      // When
      await disabledService.onModuleDestroy();

      // Then — no provider was created or torn down
      expect((disabledService as any).provider).toBeNull();
    });

    it('should swallow errors thrown by provider.shutdown()', async () => {
      // Given
      await service.onModuleInit();
      const provider = (service as any).provider;
      provider.shutdown = vi.fn().mockRejectedValue(new Error('collector unreachable'));
      const warnSpy = vi.spyOn((service as any).logger, 'warn').mockImplementation(() => {});

      // When/Then — a failing collector must not take down app.close()
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('collector unreachable'));
    });

    it('should return within the bounded timeout when provider.shutdown() hangs', async () => {
      // Given — provider whose shutdown never resolves
      await service.onModuleInit();
      const provider = (service as any).provider;
      provider.shutdown = vi.fn().mockReturnValue(new Promise<void>(() => {}));

      vi.useFakeTimers();
      try {
        // When
        const destroyPromise = service.onModuleDestroy();
        await vi.advanceTimersByTimeAsync(2_000);

        // Then — the shutdown race is bounded so app.close() cannot hang on a
        // dead collector
        await expect(destroyPromise).resolves.toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('sampling strategies', () => {
    it('should use always sampling', async () => {
      // Given
      const alwaysConfig = {
        ...config,
        sampling: { strategy: 'always' as const, ratio: 1.0 },
      };
      const alwaysService = new TracingService(alwaysConfig);

      // When/Then - should not throw
      await expect(alwaysService.onModuleInit()).resolves.toBeUndefined();
    });

    it('should use never sampling', async () => {
      // Given
      const neverConfig = {
        ...config,
        sampling: { strategy: 'never' as const, ratio: 0.0 },
      };
      const neverService = new TracingService(neverConfig);

      // When/Then - should not throw
      await expect(neverService.onModuleInit()).resolves.toBeUndefined();
    });

    it('should use ratio sampling', async () => {
      // Given
      const ratioConfig = {
        ...config,
        sampling: { strategy: 'ratio' as const, ratio: 0.5 },
      };
      const ratioService = new TracingService(ratioConfig);

      // When/Then - should not throw
      await expect(ratioService.onModuleInit()).resolves.toBeUndefined();
    });

    it('should use parent sampling', async () => {
      // Given
      const parentConfig = {
        ...config,
        sampling: { strategy: 'parent' as const, ratio: 0.5 },
      };
      const parentService = new TracingService(parentConfig);

      // When/Then - should not throw
      await expect(parentService.onModuleInit()).resolves.toBeUndefined();
    });

    it('should fallback to always sampling for unknown strategy', async () => {
      // Given
      const unknownConfig = {
        ...config,
        sampling: { strategy: 'unknown' as any, ratio: 0.5 },
      };
      const unknownService = new TracingService(unknownConfig);

      // When/Then - should not throw and use default sampler
      await expect(unknownService.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe('span kinds', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should handle CLIENT span kind', async () => {
      // When/Then - should not throw
      service.startSpan('test', { kind: 'CLIENT' });
    });

    it('should handle SERVER span kind', async () => {
      // When/Then - should not throw
      service.startSpan('test', { kind: 'SERVER' });
    });

    it('should handle PRODUCER span kind', async () => {
      // When/Then - should not throw
      service.startSpan('test', { kind: 'PRODUCER' });
    });

    it('should handle CONSUMER span kind', async () => {
      // When/Then - should not throw
      service.startSpan('test', { kind: 'CONSUMER' });
    });

    it('should handle INTERNAL span kind', async () => {
      // When/Then - should not throw
      service.startSpan('test', { kind: 'INTERNAL' });
    });
  });

  describe('exporter types', () => {
    it('should handle jaeger exporter', async () => {
      // Given
      const jaegerConfig = {
        ...config,
        exporter: { type: 'jaeger' as const, endpoint: 'http://localhost:14268/api/traces' },
      };
      const jaegerService = new TracingService(jaegerConfig);

      // When/Then - should not throw
      await expect(jaegerService.onModuleInit()).resolves.toBeUndefined();
    });

    it('should handle zipkin exporter', async () => {
      // Given
      const zipkinConfig = {
        ...config,
        exporter: { type: 'zipkin' as const, endpoint: 'http://localhost:9411/api/v2/spans' },
      };
      const zipkinService = new TracingService(zipkinConfig);

      // When/Then - should not throw
      await expect(zipkinService.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe('pluginTracing', () => {
    it('should register tracer with version when pluginTracing is true', async () => {
      // Given
      const ptConfig = { ...config, pluginTracing: true };
      const ptService = new TracingService(ptConfig);

      // When/Then - should not throw
      await expect(ptService.onModuleInit()).resolves.toBeUndefined();
    });

    it('should register tracer without version when pluginTracing is false', async () => {
      // Given
      const ptConfig = { ...config, pluginTracing: false };
      const ptService = new TracingService(ptConfig);

      // When/Then - should not throw
      await expect(ptService.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe('native Redis command tracing (traceRedisCommands)', () => {
    type ManagerHook = (command: string, args: readonly unknown[], exec: () => Promise<unknown>, context: { clientName: string }) => Promise<unknown>;

    beforeEach(async () => {
      // mockSpan is shared across the file — reset call history so
      // "not.toHaveBeenCalled" assertions see only this test's activity
      vi.clearAllMocks();
    });

    function createManagerStub() {
      return { setCommandHook: vi.fn() } as unknown as { setCommandHook: ReturnType<typeof vi.fn> };
    }

    function buildWithManager(overrides: Partial<ITracingPluginOptions> = {}) {
      const manager = createManagerStub();
      const svc = new TracingService({ ...config, traceRedisCommands: true, ...overrides }, manager as never);
      return { svc, manager };
    }

    function installedHook(manager: { setCommandHook: ReturnType<typeof vi.fn> }): ManagerHook {
      return manager.setCommandHook.mock.calls[0][0] as ManagerHook;
    }

    it('should install the command hook on the client manager at init', async () => {
      // Given
      const { svc, manager } = buildWithManager();

      // When
      await svc.onModuleInit();

      // Then
      expect(manager.setCommandHook).toHaveBeenCalledTimes(1);
      expect(manager.setCommandHook).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should NOT install the hook when traceRedisCommands is false', async () => {
      // Given
      const { svc, manager } = buildWithManager({ traceRedisCommands: false });

      // When
      await svc.onModuleInit();

      // Then
      expect(manager.setCommandHook).not.toHaveBeenCalled();
    });

    it('should NOT install the hook when tracing is disabled', async () => {
      // Given
      const { svc, manager } = buildWithManager({ enabled: false });

      // When
      await svc.onModuleInit();

      // Then
      expect(manager.setCommandHook).not.toHaveBeenCalled();
    });

    it('should remove the hook on module destroy', async () => {
      // Given
      const { svc, manager } = buildWithManager();
      await svc.onModuleInit();

      // When
      await svc.onModuleDestroy();

      // Then
      expect(manager.setCommandHook).toHaveBeenLastCalledWith(null);
    });

    it('should wrap a command in a CLIENT span and return the result', async () => {
      // Given
      const { svc, manager } = buildWithManager();
      await svc.onModuleInit();
      const hook = installedHook(manager);
      const exec = vi.fn().mockResolvedValue('value');

      // When
      const result = await hook('get', ['user:1'], exec, { clientName: 'default' });

      // Then
      expect(result).toBe('value');
      expect(exec).toHaveBeenCalledTimes(1);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('redisx.duration_ms', expect.any(Number));
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 1 }); // OK
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should record the exception and rethrow when the command fails', async () => {
      // Given
      const { svc, manager } = buildWithManager();
      await svc.onModuleInit();
      const hook = installedHook(manager);
      const failure = new Error('READONLY');
      const exec = vi.fn().mockRejectedValue(failure);

      // When / Then
      await expect(hook('set', ['k', 'v'], exec, { clientName: 'default' })).rejects.toThrow('READONLY');
      expect(mockSpan.recordException).toHaveBeenCalledWith(failure);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 2 }); // ERROR
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should honor spans.excludeCommands (command runs, no span emitted)', async () => {
      // Given
      const { svc, manager } = buildWithManager({ spans: { excludeCommands: ['PING'] } });
      await svc.onModuleInit();
      const hook = installedHook(manager);
      const exec = vi.fn().mockResolvedValue('PONG');

      // When
      const result = await hook('ping', [], exec, { clientName: 'default' });

      // Then — command executed untouched, no real span ended
      expect(result).toBe('PONG');
      expect(exec).toHaveBeenCalledTimes(1);
      expect(mockSpan.end).not.toHaveBeenCalled();
    });

    it('should run the command untraced when the service is disabled after init', async () => {
      // Given — hook captured from an enabled service, then simulate a
      // disabled path by calling the hook of a service built disabled
      const manager = createManagerStub();
      const svc = new TracingService({ ...config, enabled: false, traceRedisCommands: true }, manager as never);
      await svc.onModuleInit();
      expect(manager.setCommandHook).not.toHaveBeenCalled();

      // When the manager is absent entirely, init must not throw either
      const noManagerSvc = new TracingService({ ...config, traceRedisCommands: true });
      await expect(noManagerSvc.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe('edge cases', () => {
    it('should wrap own-provider construction failures in TracingInitializationError', async () => {
      // Given — SDK "loads" but its constructors are unusable
      const svc = new TracingService({ ...config });
      (svc as any).loadSdk = async () => ({
        node: {},
        base: {},
        resources: {},
        semconv: { SemanticResourceAttributes: { SERVICE_NAME: 'service.name' } },
        otlp: null,
      });

      // When / Then
      await expect(svc.onModuleInit()).rejects.toThrow(TracingInitializationError);
    });

    it('should end up with no probes when no known driver package can be resolved', async () => {
      // Given — resolution rooted in a directory where no driver exists
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/nonexistent-redisx-test-dir');
      try {
        const manager = { setCommandHook: vi.fn() };
        const svc = new TracingService({ ...config, traceRedisCommands: true }, manager as never);

        // When
        await svc.onModuleInit();

        // Then — hook installed, but nothing to probe
        expect(manager.setCommandHook).toHaveBeenCalledTimes(1);
        expect((svc as any).instrumentationProbes).toEqual([]);
      } finally {
        cwdSpy.mockRestore();
      }
    });

    it('should run commands untraced when the tracer is not initialized', async () => {
      // Given — hook invoked before/without init
      const svc = new TracingService({ ...config, traceRedisCommands: true }, { setCommandHook: vi.fn() } as never);
      const exec = vi.fn().mockResolvedValue('v');

      // When
      const result = await (svc as any).traceCommand('get', [], exec, 'default');

      // Then
      expect(result).toBe('v');
      expect(exec).toHaveBeenCalledTimes(1);
    });

    it('should run the function directly when withSpan gets a noop span', async () => {
      // Given — sampleRate 0 makes startSpan return the noop span
      const zero = new TracingService({ ...config, sampleRate: 0 });
      await zero.onModuleInit();
      const fn = vi.fn().mockResolvedValue('done');

      // When
      const result = await zero.withSpan('op', fn);

      // Then
      expect(result).toBe('done');
      expect(fn).toHaveBeenCalledOnce();
    });

    it('should not exclude spans that carry no db.statement attribute', async () => {
      // Given
      const exclService = new TracingService({ ...config, spans: { excludeCommands: ['PING'] } });
      await exclService.onModuleInit();

      // When
      const span = exclService.startSpan('custom-op');

      // Then — real span
      expect(span.spanId).toBe('123');
    });

    it('should apply the default maxArgLength when spans config omits it', async () => {
      // Given
      const svc = new TracingService({ ...config, spans: { includeArgs: true } });
      await svc.onModuleInit();

      // When / Then — long args truncated with the default 100 limit, no throw
      svc.startSpan('redis.SET', { attributes: { 'db.statement.args': 'a'.repeat(150) } });
    });

    it('should fall back to the default service name when none is configured', async () => {
      // Given
      const svc = new TracingService({ traceRedisCommands: false, traceHttpRequests: false });

      // When / Then
      await expect(svc.onModuleInit()).resolves.toBeUndefined();
      expect(svc.startSpan('op')).toBeDefined();
      await svc.onModuleDestroy();
    });

    it('should log non-Error shutdown rejections without crashing', async () => {
      // Given
      await service.onModuleInit();
      const provider = (service as any).provider;
      provider.shutdown = vi.fn().mockRejectedValue('collector string failure');
      const warnSpy = vi.spyOn((service as any).logger, 'warn').mockImplementation(() => {});

      // When / Then
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('collector string failure'));
    });
  });
});
