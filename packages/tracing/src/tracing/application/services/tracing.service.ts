import { createRequire } from 'module';
import { join } from 'path';

import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import type { Tracer } from '@opentelemetry/api';
import { trace, context, SpanKind } from '@opentelemetry/api';
import { CLIENT_MANAGER, RedisClientManager } from '@nestjs-redisx/core';

import { TRACING_PLUGIN_OPTIONS } from '../../../shared/constants';
import { TracingInitializationError } from '../../../shared/errors';
import type { ISpanOptions } from '../../../shared/types';
import { ITracingPluginOptions } from '../../../shared/types';
import { SpanWrapper } from '../../domain/value-objects/span-wrapper.vo';
import type { ISpan } from '../ports/span.port';
import type { ITracingService } from '../ports/tracing-service.port';

// Type-only references to the SDK packages — erased at compile time, so the
// only RUNTIME OpenTelemetry import of this file is `@opentelemetry/api`.
// The SDK itself is loaded via dynamic import() exclusively on the
// standalone-provider path (see loadSdk).
type SdkTraceBase = typeof import('@opentelemetry/sdk-trace-base');
type SdkTraceNode = typeof import('@opentelemetry/sdk-trace-node');
type SdkResources = typeof import('@opentelemetry/resources');
type SdkSemconv = typeof import('@opentelemetry/semantic-conventions');
type SdkOtlpExporter = typeof import('@opentelemetry/exporter-trace-otlp-http');

interface ILoadedSdk {
  node: SdkTraceNode;
  base: SdkTraceBase;
  resources: SdkResources;
  semconv: SdkSemconv;
  /** Present unless the console exporter was configured. */
  otlp: SdkOtlpExporter | null;
}

type OwnTracerProvider = InstanceType<SdkTraceNode['NodeTracerProvider']>;

// Slot the OpenTelemetry API uses for global registrations
// (trace/context/propagation/diag). Checking `.trace` on it is the reliable
// way to know whether the application registered a tracer provider —
// constructor-name checks break under minification.
const OTEL_API_GLOBAL_KEY = Symbol.for('opentelemetry.js.api.1');

@Injectable()
export class TracingService implements ITracingService, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TracingService.name);
  private provider: OwnTracerProvider | null = null;
  private tracer: Tracer | null = null;
  private readonly enabled: boolean;
  private instrumentationProbes: Array<() => boolean> = [];
  private externallyInstrumented = false;

  constructor(
    @Inject(TRACING_PLUGIN_OPTIONS)
    private readonly config: ITracingPluginOptions,
    @Optional()
    @Inject(CLIENT_MANAGER)
    private readonly clientManager?: RedisClientManager,
  ) {
    this.enabled = config.enabled !== false;
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) return;

    this.warnExternalDependencies();

    const mode = this.config.provider ?? 'auto';
    if (mode !== 'external') {
      if (this.hasExternalGlobalProvider()) {
        if (mode === 'standalone') {
          this.logger.warn("provider: 'standalone' requested, but a global OpenTelemetry tracer provider is already registered — using it instead. The plugin never overrides an application provider.");
        }
      } else {
        await this.setupOwnProvider(mode);
      }
    }

    this.tracer = trace.getTracer(this.config.serviceName ?? 'redisx', this.config.pluginTracing !== false ? '0.1.0' : undefined);

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

  /** True when the application (or anything else) registered a global tracer provider. */
  private hasExternalGlobalProvider(): boolean {
    const slot = (globalThis as Record<symbol, unknown>)[OTEL_API_GLOBAL_KEY] as Record<string, unknown> | undefined;
    return Boolean(slot?.['trace']);
  }

  /**
   * Standalone-provider setup: loads the OTel SDK via dynamic import() and
   * registers an own provider. Only ever called when NO global provider is
   * registered. In 'auto' mode a missing SDK degrades to a no-op with one
   * informational line; in explicit 'standalone' mode it is an error.
   */
  private async setupOwnProvider(mode: 'auto' | 'standalone'): Promise<void> {
    let sdk: ILoadedSdk;
    try {
      sdk = await this.loadSdk();
    } catch (error) {
      if (mode === 'standalone') {
        throw new TracingInitializationError(error instanceof Error ? error : undefined);
      }
      this.logger.log('OpenTelemetry SDK packages are not available — tracing runs in no-op mode. Register a tracer provider in your application (or install @opentelemetry/sdk-trace-node and related packages) to activate spans.');
      return;
    }

    try {
      const resourceAttrs: Record<string, string | number | boolean> = {
        [sdk.semconv.SemanticResourceAttributes.SERVICE_NAME]: this.config.serviceName ?? 'redisx',
        ...this.config.resourceAttributes,
      };

      const provider = new sdk.node.NodeTracerProvider({
        resource: new sdk.resources.Resource(resourceAttrs),
        sampler: this.createSampler(sdk.base),
      });

      const exporter = this.createExporter(sdk);
      const processor = this.config.exporter?.type === 'console' ? new sdk.base.SimpleSpanProcessor(exporter) : new sdk.base.BatchSpanProcessor(exporter);

      provider.addSpanProcessor(processor);
      provider.register();
      this.provider = provider;
    } catch (error) {
      throw new TracingInitializationError(error instanceof Error ? error : undefined);
    }
  }

  private async loadSdk(): Promise<ILoadedSdk> {
    const [node, base, resources, semconv] = await Promise.all([import('@opentelemetry/sdk-trace-node'), import('@opentelemetry/sdk-trace-base'), import('@opentelemetry/resources'), import('@opentelemetry/semantic-conventions')]);

    const otlp = this.config.exporter?.type === 'console' ? null : await import('@opentelemetry/exporter-trace-otlp-http');

    return { node, base, resources, semconv, otlp };
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

    if (this.config.traceRedisCommands !== 'force') {
      this.setupInstrumentationProbes();
    }

    this.clientManager.setCommandHook((command, args, exec, { clientName }) => this.traceCommand(command, args, exec, clientName));
  }

  /**
   * Builds cheap per-command probes that report whether an external
   * OpenTelemetry Redis instrumentation is currently active. OTel
   * instrumentations patch driver methods via shimmer, which marks the
   * wrapper function with `__wrapped = true` — and unmarks it on disable().
   */
  private setupInstrumentationProbes(): void {
    const probes: Array<() => boolean> = [];
    const appRequire = createRequire(join(process.cwd(), 'index.js'));

    // ioredis: @opentelemetry/instrumentation-ioredis wraps Redis.prototype.sendCommand
    try {
      const mod = appRequire('ioredis') as { prototype?: Record<string, unknown>; default?: { prototype?: Record<string, unknown> } };
      const proto = mod?.prototype ?? mod?.default?.prototype;
      if (proto) {
        probes.push(() => (proto['sendCommand'] as { __wrapped?: boolean } | undefined)?.__wrapped === true);
      }
    } catch {
      // driver not installed — nothing to probe
    }

    // node-redis: @opentelemetry/instrumentation-redis-4 patches the client
    // class inside @redis/client (internal path — the same file it patches)
    try {
      const mod = appRequire('@redis/client/dist/lib/client/index.js') as { default?: { prototype?: Record<string, unknown> } };
      const proto = mod?.default?.prototype;
      if (proto) {
        probes.push(() => ['sendCommand', 'commandsExecutor'].some((method) => (proto[method] as { __wrapped?: boolean } | undefined)?.__wrapped === true));
      }
    } catch {
      // driver not installed — nothing to probe
    }

    this.instrumentationProbes = probes;
  }

  /**
   * Evaluated per command so late-enabled or runtime-disabled external
   * instrumentation is always respected. Logs once per state transition.
   */
  private isExternallyInstrumented(): boolean {
    if (this.config.traceRedisCommands === 'force' || this.instrumentationProbes.length === 0) {
      return false;
    }

    const active = this.instrumentationProbes.some((probe) => probe());
    if (active !== this.externallyInstrumented) {
      this.externallyInstrumented = active;
      if (active) {
        this.logger.log("External OpenTelemetry Redis instrumentation detected — pausing the native command hook to avoid duplicate spans. Set traceRedisCommands: 'force' to emit both.");
      } else {
        this.logger.log('External OpenTelemetry Redis instrumentation is no longer active — the native command hook resumed emitting redis.* spans.');
      }
    }
    return active;
  }

  private async traceCommand(command: string, args: readonly unknown[], exec: () => Promise<unknown>, clientName: string): Promise<unknown> {
    if (!this.enabled || !this.tracer) {
      return exec();
    }

    // An active external instrumentation already emits a span for this
    // command — run it untouched instead of duplicating.
    if (this.isExternallyInstrumented()) {
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

  private createExporter(sdk: ILoadedSdk): InstanceType<SdkTraceBase['ConsoleSpanExporter']> | InstanceType<SdkOtlpExporter['OTLPTraceExporter']> {
    const type = this.config.exporter?.type ?? 'otlp';
    const endpoint = this.config.exporter?.endpoint;
    const headers = this.config.exporter?.headers;

    switch (type) {
      case 'console':
        return new sdk.base.ConsoleSpanExporter();
      case 'otlp':
      case 'jaeger':
      case 'zipkin':
      default:
        return new sdk.otlp!.OTLPTraceExporter({
          url: endpoint,
          headers,
        });
    }
  }

  private createSampler(base: SdkTraceBase): InstanceType<SdkTraceBase['AlwaysOnSampler']> | InstanceType<SdkTraceBase['AlwaysOffSampler']> | InstanceType<SdkTraceBase['TraceIdRatioBasedSampler']> | InstanceType<SdkTraceBase['ParentBasedSampler']> {
    // Default is parent-based (OTel SDK convention, parentbased_always_on):
    // with 'always', an app that head-samples its request traces would still
    // get RedisX spans for UNsampled requests — orphaned spans whose parents
    // were dropped upstream.
    const strategy = this.config.sampling?.strategy ?? 'parent';
    const ratio = this.config.sampling?.ratio ?? 1.0;

    switch (strategy) {
      case 'always':
        return new base.AlwaysOnSampler();
      case 'never':
        return new base.AlwaysOffSampler();
      case 'ratio':
        return new base.TraceIdRatioBasedSampler(ratio);
      case 'parent':
      default:
        return new base.ParentBasedSampler({
          root: new base.TraceIdRatioBasedSampler(ratio),
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
