import { describe, it, expect, afterEach, vi } from 'vitest';
import { trace, context, propagation } from '@opentelemetry/api';
import { TracingService } from '../../src/tracing/application/services/tracing.service';
import type { ITracingPluginOptions } from '../../src/shared/types';
import { TracingInitializationError } from '../../src/shared/errors';

// Simulate the OTel SDK not being installed: the dynamic import() inside the
// standalone setup path must reject exactly like a missing package would.
vi.mock('@opentelemetry/sdk-trace-node', () => {
  throw new Error("Cannot find module '@opentelemetry/sdk-trace-node'");
});

describe('TracingService without the OpenTelemetry SDK installed', () => {
  const baseConfig: ITracingPluginOptions = {
    enabled: true,
    serviceName: 'sdk-absent-test',
    traceRedisCommands: false,
    traceHttpRequests: false,
  };

  afterEach(() => {
    trace.disable();
    context.disable();
    propagation.disable();
  });

  it("should fall back to a silent no-op with one info line in 'auto' mode", async () => {
    // Given
    const service = new TracingService({ ...baseConfig });
    const logSpy = vi.spyOn((service as any).logger, 'log').mockImplementation(() => {});

    // When
    await service.onModuleInit();

    // Then — no throw, no own provider, one informational line
    expect((service as any).provider).toBeNull();
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain('no-op');

    // And the service API keeps working end to end
    const span = service.startSpan('noop');
    expect(() => span.setAttribute('k', 'v').end()).not.toThrow();
    await expect(service.withSpan('fn', () => 42)).resolves.toBe(42);
    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
  });

  it("should throw TracingInitializationError in explicit 'standalone' mode", async () => {
    // Given — the user explicitly demanded an own provider
    const service = new TracingService({ ...baseConfig, provider: 'standalone' });

    // When / Then
    await expect(service.onModuleInit()).rejects.toThrow(TracingInitializationError);
  });

  it("should stay a pure API consumer in 'external' mode (SDK never needed)", async () => {
    // Given
    const service = new TracingService({ ...baseConfig, provider: 'external' });

    // When / Then — external mode must not even try to load the SDK
    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect((service as any).provider).toBeNull();
  });
});
