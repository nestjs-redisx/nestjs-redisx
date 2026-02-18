/**
 * Metrics plugin for NestJS RedisX.
 * Provides Prometheus metrics collection and export.
 */

import { DynamicModule, ForwardReference, Provider, Type } from '@nestjs/common';
import { IRedisXPlugin, IPluginAsyncOptions } from '@nestjs-redisx/core';
import { METRICS_PLUGIN_OPTIONS, METRICS_SERVICE } from './shared/constants';
import { IMetricsPluginOptions } from './shared/types';
import { MetricsService } from './metrics/application/services/metrics.service';
import { MetricsController } from './metrics/api/controllers/metrics.controller';

const DEFAULT_METRICS_CONFIG: Required<Omit<IMetricsPluginOptions, 'isGlobal' | 'defaultLabels'>> = {
  enabled: true,
  prefix: 'redisx_',
  exposeEndpoint: true,
  endpoint: '/metrics',
  histogramBuckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  collectDefaultMetrics: true,
  commandMetrics: true,
  pluginMetrics: true,
  collectInterval: 15000,
};

/**
 * Metrics plugin for NestJS RedisX.
 *
 * Provides Prometheus metrics:
 * - Redis command latency
 * - Connection pool stats
 * - Cache hit/miss rates
 * - Error counts
 * - HTTP endpoint for Prometheus scraping
 *
 * @example
 * ```typescript
 * @Module({
 *   imports: [
 *     RedisModule.forRoot({
 *       clients: { host: 'localhost', port: 6379 },
 *       plugins: [
 *         new MetricsPlugin({
 *           enabled: true,
 *           exposeEndpoint: true,
 *           endpoint: '/metrics',
 *         }),
 *       ],
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
export class MetricsPlugin implements IRedisXPlugin {
  readonly name = 'metrics';
  readonly version = '0.1.0';
  readonly description = 'Prometheus metrics collection and export';

  private asyncOptions?: IPluginAsyncOptions<IMetricsPluginOptions>;

  constructor(private readonly options: IMetricsPluginOptions = {}) {}

  static registerAsync(asyncOptions: IPluginAsyncOptions<IMetricsPluginOptions>): MetricsPlugin {
    const plugin = new MetricsPlugin();
    plugin.asyncOptions = asyncOptions;
    return plugin;
  }

  private static mergeDefaults(options: IMetricsPluginOptions): IMetricsPluginOptions {
    return {
      enabled: options.enabled ?? DEFAULT_METRICS_CONFIG.enabled,
      prefix: options.prefix ?? DEFAULT_METRICS_CONFIG.prefix,
      exposeEndpoint: options.exposeEndpoint ?? DEFAULT_METRICS_CONFIG.exposeEndpoint,
      endpoint: options.endpoint ?? DEFAULT_METRICS_CONFIG.endpoint,
      histogramBuckets: options.histogramBuckets ?? DEFAULT_METRICS_CONFIG.histogramBuckets,
      collectDefaultMetrics: options.collectDefaultMetrics ?? DEFAULT_METRICS_CONFIG.collectDefaultMetrics,
      commandMetrics: options.commandMetrics ?? DEFAULT_METRICS_CONFIG.commandMetrics,
      pluginMetrics: options.pluginMetrics ?? DEFAULT_METRICS_CONFIG.pluginMetrics,
      collectInterval: options.collectInterval ?? DEFAULT_METRICS_CONFIG.collectInterval,
      defaultLabels: options.defaultLabels,
    };
  }

  getImports(): Array<Type<unknown> | DynamicModule | ForwardReference> {
    return this.asyncOptions?.imports ?? [];
  }

  getProviders(): Provider[] {
    const optionsProvider: Provider = this.asyncOptions
      ? {
          provide: METRICS_PLUGIN_OPTIONS,
          useFactory: async (...args: unknown[]) => {
            const userOptions = await this.asyncOptions!.useFactory(...args);
            return MetricsPlugin.mergeDefaults(userOptions);
          },
          inject: this.asyncOptions.inject || [],
        }
      : {
          provide: METRICS_PLUGIN_OPTIONS,
          useValue: MetricsPlugin.mergeDefaults(this.options),
        };

    return [optionsProvider, { provide: METRICS_SERVICE, useClass: MetricsService }];
  }

  getExports(): Array<string | symbol | Provider> {
    return [METRICS_SERVICE];
  }

  getControllers(): Type[] {
    // Only expose controller if endpoint is enabled
    if (this.options.exposeEndpoint !== false) {
      return [MetricsController];
    }
    return [];
  }
}
