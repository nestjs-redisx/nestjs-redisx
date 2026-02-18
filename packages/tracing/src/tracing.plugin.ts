/**
 * Tracing plugin for NestJS RedisX.
 * Provides OpenTelemetry distributed tracing support.
 */

import type { DynamicModule, ForwardReference, Provider, Type } from '@nestjs/common';
import type { IRedisXPlugin, IPluginAsyncOptions } from '@nestjs-redisx/core';
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

  private asyncOptions?: IPluginAsyncOptions<ITracingPluginOptions>;

  constructor(private readonly options: ITracingPluginOptions = {}) {}

  static registerAsync(asyncOptions: IPluginAsyncOptions<ITracingPluginOptions>): TracingPlugin {
    const plugin = new TracingPlugin();
    plugin.asyncOptions = asyncOptions;
    return plugin;
  }

  private static mergeDefaults(options: ITracingPluginOptions): ITracingPluginOptions {
    return {
      enabled: options.enabled ?? DEFAULT_TRACING_CONFIG.enabled,
      serviceName: options.serviceName ?? DEFAULT_TRACING_CONFIG.serviceName,
      sampleRate: options.sampleRate ?? DEFAULT_TRACING_CONFIG.sampleRate,
      traceRedisCommands: options.traceRedisCommands ?? DEFAULT_TRACING_CONFIG.traceRedisCommands,
      traceHttpRequests: options.traceHttpRequests ?? DEFAULT_TRACING_CONFIG.traceHttpRequests,
      sampling: {
        strategy: options.sampling?.strategy ?? DEFAULT_TRACING_CONFIG.sampling.strategy,
        ratio: options.sampling?.ratio ?? DEFAULT_TRACING_CONFIG.sampling.ratio,
      },
      spans: {
        includeArgs: options.spans?.includeArgs ?? DEFAULT_TRACING_CONFIG.spans.includeArgs,
        includeResult: options.spans?.includeResult ?? DEFAULT_TRACING_CONFIG.spans.includeResult,
        maxArgLength: options.spans?.maxArgLength ?? DEFAULT_TRACING_CONFIG.spans.maxArgLength,
        excludeCommands: options.spans?.excludeCommands ?? DEFAULT_TRACING_CONFIG.spans.excludeCommands,
      },
      pluginTracing: options.pluginTracing ?? DEFAULT_TRACING_CONFIG.pluginTracing,
      exporter: options.exporter,
      resourceAttributes: options.resourceAttributes,
    };
  }

  getImports(): Array<Type<unknown> | DynamicModule | ForwardReference> {
    return this.asyncOptions?.imports ?? [];
  }

  getProviders(): Provider[] {
    const optionsProvider: Provider = this.asyncOptions
      ? {
          provide: TRACING_PLUGIN_OPTIONS,
          useFactory: async (...args: unknown[]) => {
            const userOptions = await this.asyncOptions!.useFactory(...args);
            return TracingPlugin.mergeDefaults(userOptions);
          },
          inject: this.asyncOptions.inject || [],
        }
      : {
          provide: TRACING_PLUGIN_OPTIONS,
          useValue: TracingPlugin.mergeDefaults(this.options),
        };

    return [optionsProvider, { provide: TRACING_SERVICE, useClass: TracingService }];
  }

  getExports(): Array<string | symbol | Provider> {
    return [TRACING_SERVICE];
  }
}
