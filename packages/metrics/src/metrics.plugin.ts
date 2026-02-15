/**
 * Metrics plugin for NestJS RedisX.
 * Provides Prometheus metrics collection and export.
 */

import { Provider, Type } from '@nestjs/common';
import { IRedisXPlugin } from '@nestjs-redisx/core';
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

  constructor(private readonly options: IMetricsPluginOptions = {}) {}

  getProviders(): Provider[] {
    const config: IMetricsPluginOptions = {
      enabled: this.options.enabled ?? DEFAULT_METRICS_CONFIG.enabled,
      prefix: this.options.prefix ?? DEFAULT_METRICS_CONFIG.prefix,
      exposeEndpoint: this.options.exposeEndpoint ?? DEFAULT_METRICS_CONFIG.exposeEndpoint,
      endpoint: this.options.endpoint ?? DEFAULT_METRICS_CONFIG.endpoint,
      histogramBuckets: this.options.histogramBuckets ?? DEFAULT_METRICS_CONFIG.histogramBuckets,
      collectDefaultMetrics: this.options.collectDefaultMetrics ?? DEFAULT_METRICS_CONFIG.collectDefaultMetrics,
      commandMetrics: this.options.commandMetrics ?? DEFAULT_METRICS_CONFIG.commandMetrics,
      pluginMetrics: this.options.pluginMetrics ?? DEFAULT_METRICS_CONFIG.pluginMetrics,
      collectInterval: this.options.collectInterval ?? DEFAULT_METRICS_CONFIG.collectInterval,
      defaultLabels: this.options.defaultLabels,
    };

    return [
      { provide: METRICS_PLUGIN_OPTIONS, useValue: config },
      { provide: METRICS_SERVICE, useClass: MetricsService },
    ];
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
