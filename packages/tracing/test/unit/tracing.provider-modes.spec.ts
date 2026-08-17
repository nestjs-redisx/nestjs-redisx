import { describe, it, expect, afterEach, vi } from 'vitest';
import { trace, context, propagation } from '@opentelemetry/api';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { TracingService } from '../../src/tracing/application/services/tracing.service';
import type { ITracingPluginOptions } from '../../src/shared/types';
import { SpanWrapper } from '../../src/tracing/domain/value-objects/span-wrapper.vo';

/**
 * Provider-mode matrix against the REAL OpenTelemetry API and SDK.
 * The global tracer provider is process-wide state, so every test cleans the
 * global registrations in afterEach — otherwise specs contaminate each other.
 */
describe('TracingService provider modes', () => {
  const baseConfig: ITracingPluginOptions = {
    enabled: true,
    serviceName: 'provider-modes-test',
    traceRedisCommands: false,
    traceHttpRequests: false,
    exporter: { type: 'console' },
  };

  let service: TracingService | undefined;
  let appProvider: NodeTracerProvider | undefined;
  let appExporter: InMemorySpanExporter | undefined;

  function registerAppProvider(): void {
    appExporter = new InMemorySpanExporter();
    appProvider = new NodeTracerProvider();
    appProvider.addSpanProcessor(new SimpleSpanProcessor(appExporter));
    appProvider.register();
  }

  function globalDelegate(): unknown {
    const proxy = trace.getTracerProvider() as { getDelegate?: () => unknown };
    return proxy.getDelegate ? proxy.getDelegate() : proxy;
  }

  afterEach(async () => {
    await service?.onModuleDestroy();
    service = undefined;
    await appProvider?.shutdown();
    appProvider = undefined;
    appExporter = undefined;
    trace.disable();
    context.disable();
    propagation.disable();
  });

  describe("mode 'auto' (default)", () => {
    it('should use the application provider and create no own provider when a global provider is registered', async () => {
      // Given — the application registered its own SDK before the plugin init
      registerAppProvider();
      service = new TracingService({ ...baseConfig });

      // When
      await service.onModuleInit();
      const span = service.startSpan('auto-external-op');
      span.end();

      // Then — span flowed into the app exporter, no own provider was built
      expect((service as any).provider).toBeNull();
      const finished = appExporter!.getFinishedSpans();
      expect(finished).toHaveLength(1);
      expect(finished[0].name).toBe('auto-external-op');
    });

    it('should build and register an own provider when no global provider exists and the SDK is available', async () => {
      // Given — pristine global state
      service = new TracingService({ ...baseConfig });

      // When
      await service.onModuleInit();

      // Then — own provider exists and IS the registered global delegate
      expect((service as any).provider).not.toBeNull();
      expect(globalDelegate()).toBe((service as any).provider);

      // And spans are recording (never .end() a console-exported span here —
      // keeps test output clean)
      const span = service.startSpan('auto-standalone-op');
      expect((span as SpanWrapper).unwrap().isRecording()).toBe(true);
    });
  });

  describe("mode 'standalone'", () => {
    it('should register an own provider on pristine global state without warning', async () => {
      // Given
      service = new TracingService({ ...baseConfig, provider: 'standalone' });
      const warnSpy = vi.spyOn((service as any).logger, 'warn').mockImplementation(() => {});

      // When
      await service.onModuleInit();

      // Then
      expect((service as any).provider).not.toBeNull();
      expect(globalDelegate()).toBe((service as any).provider);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should NEVER register over an existing global provider — warn and degrade to external', async () => {
      // Given — app provider registered first
      registerAppProvider();
      service = new TracingService({ ...baseConfig, provider: 'standalone' });
      const warnSpy = vi.spyOn((service as any).logger, 'warn').mockImplementation(() => {});

      // When
      await service.onModuleInit();
      const span = service.startSpan('standalone-degraded-op');
      span.end();

      // Then — global delegate untouched, our spans flow to the app provider
      expect((service as any).provider).toBeNull();
      expect(globalDelegate()).toBe(appProvider);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(appExporter!.getFinishedSpans().map((s) => s.name)).toEqual(['standalone-degraded-op']);
    });
  });

  describe("mode 'external'", () => {
    it('should only use trace.getTracer() and never register a provider when a global provider exists', async () => {
      // Given
      registerAppProvider();
      service = new TracingService({ ...baseConfig, provider: 'external' });

      // When
      await service.onModuleInit();
      const span = service.startSpan('external-op');
      span.end();

      // Then
      expect((service as any).provider).toBeNull();
      expect(globalDelegate()).toBe(appProvider);
      expect(appExporter!.getFinishedSpans().map((s) => s.name)).toEqual(['external-op']);
    });

    it('should degrade to non-recording no-op spans when no global provider exists', async () => {
      // Given — no app SDK, external mode: getTracer() returns a proxy no-op
      service = new TracingService({ ...baseConfig, provider: 'external' });

      // When
      await service.onModuleInit();

      // Then — nothing registered, nothing thrown, spans are non-recording
      expect((service as any).provider).toBeNull();
      const span = service.startSpan('noop-op');
      expect((span as SpanWrapper).unwrap().isRecording()).toBe(false);
      span.end();

      const result = await service.withSpan('noop-fn', () => 'value');
      expect(result).toBe('value');

      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    });
  });
});
