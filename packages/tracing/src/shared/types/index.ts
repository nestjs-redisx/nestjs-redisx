export interface ITracingPluginOptions {
  /**
   * Make the module global.
   * @default false
   */
  isGlobal?: boolean;

  /**
   * Enable tracing.
   * @default true
   */
  enabled?: boolean;

  /**
   * Service name for spans.
   * Used as `service.name` resource attribute and default span attribute.
   * @default 'redisx'
   */
  serviceName?: string;

  /**
   * Sample rate for traces (0-1).
   * Applied as a pre-check before OTel SDK sampler.
   * Use `sampling.strategy: 'ratio'` for SDK-level sampling.
   * @default 1.0
   */
  sampleRate?: number;

  /**
   * Enable automatic Redis command tracing.
   * @remarks Requires `@opentelemetry/instrumentation-redis` to be installed and configured separately.
   * This option logs a warning if enabled without the instrumentation package.
   * @default true
   */
  traceRedisCommands?: boolean;

  /**
   * Enable automatic HTTP request tracing.
   * @remarks Requires `@opentelemetry/instrumentation-http` to be installed and configured separately.
   * This option logs a warning if enabled without the instrumentation package.
   * @default true
   */
  traceHttpRequests?: boolean;

  /**
   * Resource attributes for traces.
   * Merged with default attributes (`service.name`).
   */
  resourceAttributes?: Record<string, string | number | boolean>;

  /**
   * Exporter configuration.
   * @remarks Requires the corresponding `@opentelemetry/exporter-*` package.
   * OTLP exporter (`@opentelemetry/exporter-trace-otlp-http`) is included by default.
   */
  exporter?: {
    /**
     * Exporter type.
     * @default 'otlp'
     */
    type?: 'otlp' | 'jaeger' | 'zipkin' | 'console';

    /**
     * Exporter endpoint URL.
     */
    endpoint?: string;

    /**
     * Custom headers for exporter.
     */
    headers?: Record<string, string>;
  };

  /**
   * Sampling configuration (SDK-level sampler).
   */
  sampling?: {
    /**
     * Sampling strategy.
     * - 'always' — always create spans
     * - 'never' — never create spans
     * - 'ratio' — sample based on `ratio` (0-1)
     * - 'parent' — inherit from parent span, fallback to ratio-based
     * @default 'always'
     */
    strategy?: 'always' | 'never' | 'ratio' | 'parent';

    /**
     * Sampling ratio (0-1) for 'ratio' and 'parent' strategies.
     * @default 1.0
     */
    ratio?: number;
  };

  /**
   * Span configuration for Redis command spans.
   */
  spans?: {
    /**
     * Include command arguments in spans (as `db.statement.args` attribute).
     * Disabled by default for security (may contain sensitive data).
     * @default false
     */
    includeArgs?: boolean;

    /**
     * Include command result in spans (as `db.statement.result` attribute).
     * @default false
     */
    includeResult?: boolean;

    /**
     * Max length for argument strings before truncation.
     * @default 100
     */
    maxArgLength?: number;

    /**
     * Commands to exclude from tracing.
     * Spans with matching `db.statement` attribute will be skipped.
     */
    excludeCommands?: string[];
  };

  /**
   * Enable plugin-specific tracing (cache, locks, streams, etc).
   * When enabled, the tracer registers with version info.
   * @default true
   */
  pluginTracing?: boolean;
}

export interface ISpanOptions {
  attributes?: Record<string, unknown>;
  kind?: 'CLIENT' | 'SERVER' | 'PRODUCER' | 'CONSUMER' | 'INTERNAL';
}
