import { createRequire } from 'module';
import { join } from 'path';

import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import type { Tracer } from '@opentelemetry/api';
import { trace, context, SpanKind } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { AlwaysOffSampler, AlwaysOnSampler, BatchSpanProcessor, ConsoleSpanExporter, ParentBasedSampler, SimpleSpanProcessor, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { CLIENT_MANAGER, RedisClientManager } from '@nestjs-redisx/core';

import { TRACING_PLUGIN_OPTIONS } from '../../../shared/constants';
import { TracingInitializationError } from '../../../shared/errors';
import type { ISpanOptions } from '../../../shared/types';
import { ITracingPluginOptions } from '../../../shared/types';
import { SpanWrapper } from '../../domain/value-objects/span-wrapper.vo';
import type { ISpan } from '../ports/span.port';
import type { ITracingService } from '../ports/tracing-service.port';

@Injectable()
export class TracingService implements ITracingService, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TracingService.name);
  private provider: NodeTracerProvider | null = null;
  private tracer: Tracer | null = null;
  private readonly enabled: boolean;

  constructor(
    @Inject(TRACING_PLUGIN_OPTIONS)
    private readonly config: ITracingPluginOptions,
    @Optional()
    @Inject(CLIENT_MANAGER)
    private readonly clientManager?: RedisClientManager,
  ) {
    this.enabled = config.enabled !== false;
  }

  onModuleInit(): void {
    if (!this.enabled) return;

    this.warnExternalDependencies();

    try {
      const resourceAttrs: Record<string, string | number | boolean> = {
        [SemanticResourceAttributes.SERVICE_NAME]: this.config.serviceName ?? 'redisx',
        ...this.config.resourceAttributes,
      };

      this.provider = new NodeTracerProvider({
        resource: new Resource(resourceAttrs),
        sampler: this.createSampler(),
      });

      const exporter = this.createExporter();
      const processor = this.config.exporter?.type === 'console' ? new SimpleSpanProcessor(exporter) : new BatchSpanProcessor(exporter);

      this.provider.addSpanProcessor(processor);
      this.provider.register();

      this.tracer = trace.getTracer(this.config.serviceName ?? 'redisx', this.config.pluginTracing !== false ? '0.1.0' : undefined);
    } catch (error) {
      throw new TracingInitializationError(error instanceof Error ? error : undefined);
    }

    if (this.config.traceRedisCommands !== false) {
      this.installCommandHook();
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.clientManager?.setCommandHook?.(null);

    if (!this.provider) return;

    // Span export can fail or hang at shutdown if the collector is down (e.g.
    // in tests or with an unreachable OTLP endpoint). A best-effort flush must
    // not take down — or even noticeably slow down — application shutdown, so
    // race the provider shutdown against a short timeout and swallow failures.
    const shutdownTimeoutMs = 2_000;
    try {
      await Promise.race([
        this.provider.shutdown(),
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, shutdownTimeoutMs);
          if (typeof timer.unref === 'function') timer.unref();
        }),
      ]);
    } catch (error) {
      this.logger.warn(`Tracing provider shutdown failed: ${(error as Error)?.message ?? error}`);
    }
  }

  startSpan(name: string, options: ISpanOptions = {}): ISpan {
    if (!this.enabled || !this.tracer) {
      return this.createNoopSpan();
    }

    // Check sampling strategy for quick rejection
    if (this.shouldSkipSpan()) {
      return this.createNoopSpan();
    }

    // Check excludeCommands
    const excludeCommands = this.config.spans?.excludeCommands ?? [];
    if (excludeCommands.length > 0) {
      const commandName = options.attributes?.['db.statement'] as string | undefined;
      if (commandName && excludeCommands.includes(commandName)) {
        return this.createNoopSpan();
      }
    }

    // Build attributes
    const attributes: Record<string, unknown> = {
      'service.name': this.config.serviceName ?? 'redisx',
      ...options.attributes,
    };

    // Apply spans.includeArgs policy — strip args if disabled
    if (this.config.spans?.includeArgs === false) {
      delete attributes['db.statement.args'];
    }

    // Apply spans.includeResult policy — strip result if disabled
    if (this.config.spans?.includeResult === false) {
      delete attributes['db.statement.result'];
    }

    // Apply maxArgLength truncation
    const maxArgLength = this.config.spans?.maxArgLength ?? 100;
    if (attributes['db.statement.args'] && typeof attributes['db.statement.args'] === 'string') {
      const args = attributes['db.statement.args'];
      if (args.length > maxArgLength) {
        attributes['db.statement.args'] = args.substring(0, maxArgLength) + '...';
      }
    }

    const span = this.tracer.startSpan(name, {
      kind: this.mapSpanKind(options.kind),
      attributes: attributes as never,
    });

    return new SpanWrapper(span);
  }

  getCurrentSpan(): ISpan | undefined {
    if (!this.enabled) return undefined;

    const span = trace.getActiveSpan();
    return span ? new SpanWrapper(span) : undefined;
  }

  async withSpan<T>(name: string, fn: () => T | Promise<T>, options: ISpanOptions = {}): Promise<T> {
    if (!this.enabled || !this.tracer) {
      return fn();
    }

    const span = this.startSpan(name, options);

    // If we got a noop span (sampling/exclude), just run the function
    if (!span.spanId) {
      return fn();
    }

    const ctx = trace.setSpan(context.active(), (span as SpanWrapper).unwrap());

    try {
      const result = await context.with(ctx, fn);
      span.setStatus('OK');
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus('ERROR');
      throw error;
    } finally {
      span.end();
    }
  }

  addEvent(name: string, attributes?: Record<string, unknown>): void {
    const span = this.getCurrentSpan();
    if (span) {
      span.addEvent(name, attributes);
    }
  }

  setAttribute(key: string, value: unknown): void {
    const span = this.getCurrentSpan();
    if (span) {
      span.setAttribute(key, value);
    }
  }

  recordException(error: Error): void {
    const span = this.getCurrentSpan();
    if (span) {
      span.recordException(error);
    }
  }

  /**
   * Wraps every Redis command executed through RedisX drivers in a CLIENT
   * span (`redis.<COMMAND>`). Native — no external instrumentation package
   * needed, and it covers runtime-created clients (e.g. the Pub/Sub
   * subscriber) because the hook is installed at the client-manager level.
   */
  private installCommandHook(): void {
    if (!this.clientManager || typeof this.clientManager.setCommandHook !== 'function') {
      return; // standalone usage without the RedisX client manager
    }

    this.clientManager.setCommandHook((command, args, exec, { clientName }) => this.traceCommand(command, args, exec, clientName));
  }

  private async traceCommand(command: string, args: readonly unknown[], exec: () => Promise<unknown>, clientName: string): Promise<unknown> {
    if (!this.enabled || !this.tracer) {
      return exec();
    }

    const operation = command.toUpperCase();
    const span = this.startSpan(`redis.${operation}`, {
      kind: 'CLIENT',
      attributes: {
        'db.system': 'redis',
        'db.operation': operation,
        // startSpan matches spans.excludeCommands against db.statement
        'db.statement': operation,
        'db.statement.args': this.safeStringify(args),
        'redisx.client': clientName,
      },
    });

    // Noop span (sampling / excludeCommands): run the command untouched.
    if (!span.spanId) {
      return exec();
    }

    const ctx = trace.setSpan(context.active(), (span as SpanWrapper).unwrap());
    const startedAt = Date.now();

    try {
      const result = await context.with(ctx, exec);
      span.setAttribute('redisx.duration_ms', Date.now() - startedAt);
      if (this.config.spans?.includeResult === true) {
        span.setAttribute('db.statement.result', this.safeStringify(result));
      }
      span.setStatus('OK');
      return result;
    } catch (error) {
      span.setAttribute('redisx.duration_ms', Date.now() - startedAt);
      span.recordException(error as Error);
      span.setStatus('ERROR');
      throw error;
    } finally {
      span.end();
    }
  }

  /** JSON-serializes a value for span attributes; truncates per maxArgLength. */
  private safeStringify(value: unknown): string {
    let serialized: string;
    try {
      serialized = JSON.stringify(value) ?? 'undefined';
    } catch {
      serialized = '[unserializable]';
    }
    const maxLength = this.config.spans?.maxArgLength ?? 100;
    return serialized.length > maxLength ? serialized.substring(0, maxLength) + '...' : serialized;
  }

  private warnExternalDependencies(): void {
    // HTTP instrumentation cannot be registered from inside the plugin: it
    // must load BEFORE the http module is imported (i.e. in the app's own
    // OpenTelemetry bootstrap). Warn only when it is actually missing.
    if (this.config.traceHttpRequests && !this.isPackageInstalled('@opentelemetry/instrumentation-http')) {
      this.logger.warn('traceHttpRequests: @opentelemetry/instrumentation-http is not installed. ' + 'Install it and register it in your OpenTelemetry bootstrap (before the application loads) to trace incoming HTTP requests.');
    }
  }

  /** Resolves a package from the application root (works in CJS and ESM builds). */
  private isPackageInstalled(packageName: string): boolean {
    try {
      const appRequire = createRequire(join(process.cwd(), 'index.js'));
      appRequire.resolve(packageName);
      return true;
    } catch {
      return false;
    }
  }

  private shouldSkipSpan(): boolean {
    // Use sampleRate as a quick pre-check (independent of OTel SDK sampler)
    const sampleRate = this.config.sampleRate ?? 1.0;
    if (sampleRate < 1.0 && Math.random() >= sampleRate) {
      return true;
    }
    return false;
  }

  private createExporter(): ConsoleSpanExporter | OTLPTraceExporter {
    const type = this.config.exporter?.type ?? 'otlp';
    const endpoint = this.config.exporter?.endpoint;
    const headers = this.config.exporter?.headers;

    switch (type) {
      case 'console':
        return new ConsoleSpanExporter();
      case 'otlp':
      case 'jaeger':
      case 'zipkin':
      default:
        return new OTLPTraceExporter({
          url: endpoint,
          headers,
        });
    }
  }

  private createSampler(): AlwaysOnSampler | AlwaysOffSampler | TraceIdRatioBasedSampler | ParentBasedSampler {
    // Default is parent-based (OTel SDK convention, parentbased_always_on):
    // with 'always', an app that head-samples its request traces would still
    // get RedisX spans for UNsampled requests — orphaned spans whose parents
    // were dropped upstream.
    const strategy = this.config.sampling?.strategy ?? 'parent';
    const ratio = this.config.sampling?.ratio ?? 1.0;

    switch (strategy) {
      case 'always':
        return new AlwaysOnSampler();
      case 'never':
        return new AlwaysOffSampler();
      case 'ratio':
        return new TraceIdRatioBasedSampler(ratio);
      case 'parent':
      default:
        return new ParentBasedSampler({
          root: new TraceIdRatioBasedSampler(ratio),
        });
    }
  }

  private mapSpanKind(kind?: string): SpanKind {
    switch (kind) {
      case 'SERVER':
        return SpanKind.SERVER;
      case 'PRODUCER':
        return SpanKind.PRODUCER;
      case 'CONSUMER':
        return SpanKind.CONSUMER;
      case 'INTERNAL':
        return SpanKind.INTERNAL;
      case 'CLIENT':
      default:
        return SpanKind.CLIENT;
    }
  }

  private createNoopSpan(): ISpan {
    return {
      spanId: '',
      traceId: '',
      setAttribute: () => this.createNoopSpan(),
      setAttributes: () => this.createNoopSpan(),
      addEvent: () => this.createNoopSpan(),
      recordException: () => this.createNoopSpan(),
      setStatus: () => this.createNoopSpan(),
      end: () => {},
    } as ISpan;
  }
}
