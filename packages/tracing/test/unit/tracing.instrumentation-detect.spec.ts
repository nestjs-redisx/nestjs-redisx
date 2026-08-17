import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { trace, context, propagation } from '@opentelemetry/api';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import Redis from 'ioredis';
import { TracingService } from '../../src/tracing/application/services/tracing.service';
import type { ITracingPluginOptions } from '../../src/shared/types';

type ManagerHook = (command: string, args: readonly unknown[], exec: () => Promise<unknown>, ctx: { clientName: string }) => Promise<unknown>;

/**
 * External-instrumentation detection for the native command hook.
 * The guard is evaluated PER COMMAND (not only at install time), so late
 * instrumentation enable and runtime disable are both handled.
 */
describe('TracingService external instrumentation detection', () => {
  const baseConfig: ITracingPluginOptions = {
    enabled: true,
    serviceName: 'instr-detect-test',
    traceRedisCommands: true,
    traceHttpRequests: false,
    provider: 'external',
  };

  let appProvider: NodeTracerProvider;
  let appExporter: InMemorySpanExporter;
  let service: TracingService;
  let manager: { setCommandHook: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    appExporter = new InMemorySpanExporter();
    appProvider = new NodeTracerProvider();
    appProvider.addSpanProcessor(new SimpleSpanProcessor(appExporter));
    appProvider.register();
    manager = { setCommandHook: vi.fn() };
  });

  afterEach(async () => {
    await service?.onModuleDestroy();
    await appProvider.shutdown();
    trace.disable();
    context.disable();
    propagation.disable();
  });

  async function build(overrides: Partial<ITracingPluginOptions> = {}): Promise<ManagerHook> {
    service = new TracingService({ ...baseConfig, ...overrides }, manager as never);
    await service.onModuleInit();
    return manager.setCommandHook.mock.calls[0][0] as ManagerHook;
  }

  it('should emit redis.* spans when no external instrumentation is active', async () => {
    // Given
    const hook = await build();
    const exec = vi.fn().mockResolvedValue('value');

    // When
    const result = await hook('get', ['k'], exec, { clientName: 'default' });

    // Then
    expect(result).toBe('value');
    expect(appExporter.getFinishedSpans().map((s) => s.name)).toEqual(['redis.GET']);
  });

  it('should pause the hook (command runs, no span) while an instrumentation probe reports wrapped', async () => {
    // Given
    const hook = await build();
    const logSpy = vi.spyOn((service as any).logger, 'log').mockImplementation(() => {});
    (service as any).instrumentationProbes = [() => true];
    const exec = vi.fn().mockResolvedValue('PONG');

    // When
    const result = await hook('ping', [], exec, { clientName: 'default' });

    // Then — no duplicate span, exactly one informational line
    expect(result).toBe('PONG');
    expect(exec).toHaveBeenCalledTimes(1);
    expect(appExporter.getFinishedSpans()).toHaveLength(0);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain('duplicate');
  });

  it('should log only on state transitions and resume tracing when instrumentation goes away', async () => {
    // Given
    const hook = await build();
    const logSpy = vi.spyOn((service as any).logger, 'log').mockImplementation(() => {});
    let wrapped = true;
    (service as any).instrumentationProbes = [() => wrapped];
    const exec = vi.fn().mockResolvedValue('v');

    // When — three commands while wrapped, then instrumentation disabled
    await hook('get', ['a'], exec, { clientName: 'default' });
    await hook('get', ['b'], exec, { clientName: 'default' });
    await hook('get', ['c'], exec, { clientName: 'default' });
    wrapped = false;
    await hook('get', ['d'], exec, { clientName: 'default' });

    // Then — one "paused" line, one "resumed" line, and the last command traced
    expect(logSpy).toHaveBeenCalledTimes(2);
    expect(appExporter.getFinishedSpans().map((s) => s.name)).toEqual(['redis.GET']);
  });

  it("should ignore probes entirely with traceRedisCommands: 'force'", async () => {
    // Given
    const hook = await build({ traceRedisCommands: 'force' });
    (service as any).instrumentationProbes = [() => true];
    const exec = vi.fn().mockResolvedValue('v');

    // When
    await hook('set', ['k', 'v'], exec, { clientName: 'default' });

    // Then — span emitted despite the wrapped probe
    expect(appExporter.getFinishedSpans().map((s) => s.name)).toEqual(['redis.SET']);
  });

  it('should serialize unserializable args defensively and truncate long args', async () => {
    // Given
    const hook = await build();
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    // When — circular structure, then an oversized argument
    await hook('set', [circular], vi.fn().mockResolvedValue('OK'), { clientName: 'default' });
    await hook('set', ['k', 'x'.repeat(300)], vi.fn().mockResolvedValue('OK'), { clientName: 'default' });

    // Then
    const spans = appExporter.getFinishedSpans();
    expect(spans[0].attributes['db.statement.args']).toBe('[unserializable]');
    // default maxArgLength (100) + '...'
    expect(String(spans[1].attributes['db.statement.args'])).toHaveLength(103);
  });

  it('should detect a shimmer-wrapped ioredis sendCommand through the real probe', async () => {
    // Given — simulate @opentelemetry/instrumentation-ioredis being active
    const hook = await build();
    expect(((service as any).instrumentationProbes as unknown[]).length).toBeGreaterThanOrEqual(1);
    const sendCommand = Redis.prototype.sendCommand as unknown as { __wrapped?: boolean };
    sendCommand.__wrapped = true;
    const exec = vi.fn().mockResolvedValue('v');

    try {
      // When
      await hook('get', ['k'], exec, { clientName: 'default' });

      // Then — hook paused, command still executed
      expect(exec).toHaveBeenCalledTimes(1);
      expect(appExporter.getFinishedSpans()).toHaveLength(0);
    } finally {
      delete sendCommand.__wrapped;
    }
  });
});
