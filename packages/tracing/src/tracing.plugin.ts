/**
 * Tracing plugin for NestJS RedisX.
 * Provides OpenTelemetry distributed tracing support.
 */

import type { Provider } from '@nestjs/common';
import type { IRedisXPlugin } from '@nestjs-redisx/core';
import { TRACING_PLUGIN_OPTIONS, TRACING_SERVICE } from './shared/constants';
import type { ITracingPluginOptions } from './shared/types';
import { TracingService } from './tracing/application/services/tracing.service';

const DEFAULT_TRACING_CONFIG: Required<Omit<ITracingPluginOptions, 'isGlobal' | 'exporter' | 'resourceAttributes'>> = {
  enabled: true,
  serviceName: 'nestjs-redisx',
  sampleRate: 1.0,
  traceRedisCommands: true,
  traceHttpRequests: true,
  sampling: {
    strategy: 'always',
    ratio: 1.0,
  },
  spans: {
    includeArgs: false,
    includeResult: false,
    maxArgLength: 100,
    excludeCommands: [],
  },
  pluginTracing: true,
};

/**
 * Tracing plugin for NestJS RedisX.
 *
 * Provides OpenTelemetry distributed tracing:
 * - Automatic Redis command tracing
 * - HTTP request tracing
 * - Custom span creation
 * - Context propagation
 * - Multiple exporter support (OTLP, Jaeger, Zipkin)
 *
 * @example
 * ```typescript
 * @Module({
 *   imports: [
 *     RedisModule.forRoot({
 *       clients: { host: 'localhost', port: 6379 },
 *       plugins: [
 *         new TracingPlugin({
 *           enabled: true,
 *           serviceName: 'my-service',
 *           exporter: {
 *             type: 'otlp',
 *             endpoint: 'http://localhost:4318/v1/traces',
 *           },
 *         }),
 *       ],
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
export class TracingPlugin implements IRedisXPlugin {
  readonly name = 'tracing';
  readonly version = '0.1.0';
  readonly description = 'OpenTelemetry distributed tracing support';

  constructor(private readonly options: ITracingPluginOptions = {}) {}

  getProviders(): Provider[] {
    const config: ITracingPluginOptions = {
      enabled: this.options.enabled ?? DEFAULT_TRACING_CONFIG.enabled,
      serviceName: this.options.serviceName ?? DEFAULT_TRACING_CONFIG.serviceName,
      sampleRate: this.options.sampleRate ?? DEFAULT_TRACING_CONFIG.sampleRate,
      traceRedisCommands: this.options.traceRedisCommands ?? DEFAULT_TRACING_CONFIG.traceRedisCommands,
      traceHttpRequests: this.options.traceHttpRequests ?? DEFAULT_TRACING_CONFIG.traceHttpRequests,
      sampling: {
        strategy: this.options.sampling?.strategy ?? DEFAULT_TRACING_CONFIG.sampling.strategy,
        ratio: this.options.sampling?.ratio ?? DEFAULT_TRACING_CONFIG.sampling.ratio,
      },
      spans: {
        includeArgs: this.options.spans?.includeArgs ?? DEFAULT_TRACING_CONFIG.spans.includeArgs,
        includeResult: this.options.spans?.includeResult ?? DEFAULT_TRACING_CONFIG.spans.includeResult,
        maxArgLength: this.options.spans?.maxArgLength ?? DEFAULT_TRACING_CONFIG.spans.maxArgLength,
        excludeCommands: this.options.spans?.excludeCommands ?? DEFAULT_TRACING_CONFIG.spans.excludeCommands,
      },
      pluginTracing: this.options.pluginTracing ?? DEFAULT_TRACING_CONFIG.pluginTracing,
      exporter: this.options.exporter,
      resourceAttributes: this.options.resourceAttributes,
    };

    return [
      { provide: TRACING_PLUGIN_OPTIONS, useValue: config },
      { provide: TRACING_SERVICE, useClass: TracingService },
    ];
  }

  getExports(): Array<string | symbol | Provider> {
    return [TRACING_SERVICE];
  }
}
