import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Injectable, Inject, Logger } from '@nestjs/common';
import type { Tracer } from '@opentelemetry/api';
import { trace, context, SpanKind } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { AlwaysOffSampler, AlwaysOnSampler, BatchSpanProcessor, ConsoleSpanExporter, ParentBasedSampler, SimpleSpanProcessor, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

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
  }

  async onModuleDestroy(): Promise<void> {
    if (this.provider) {
      await this.provider.shutdown();
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

  private warnExternalDependencies(): void {
    if (this.config.traceRedisCommands) {
      this.logger.warn('traceRedisCommands requires @opentelemetry/instrumentation-redis to be installed and configured separately');
    }

    if (this.config.traceHttpRequests) {
      this.logger.warn('traceHttpRequests requires @opentelemetry/instrumentation-http to be installed and configured separately');
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
    const strategy = this.config.sampling?.strategy ?? 'always';
    const ratio = this.config.sampling?.ratio ?? 1.0;

    switch (strategy) {
      case 'always':
        return new AlwaysOnSampler();
      case 'never':
        return new AlwaysOffSampler();
      case 'ratio':
        return new TraceIdRatioBasedSampler(ratio);
      case 'parent':
        return new ParentBasedSampler({
          root: new TraceIdRatioBasedSampler(ratio),
        });
      default:
        return new AlwaysOnSampler();
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
