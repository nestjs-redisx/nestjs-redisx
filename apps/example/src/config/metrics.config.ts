/**
 * @fileoverview Metrics module configuration.
 */

import { ConfigService } from '@nestjs/config';
import { IMetricsPluginOptions } from '@nestjs-redisx/metrics';

export const metricsConfig = (
  config: ConfigService,
): IMetricsPluginOptions => ({
  enabled: config.get<boolean>('METRICS_ENABLED', true),
  prefix: config.get<string>('METRICS_PREFIX', 'redisx_'),
  exposeEndpoint: true,
  endpoint: config.get<string>('METRICS_PATH', '/metrics'),

  defaultLabels: {
    app: 'redisx-example',
    env: config.get<string>('NODE_ENV', 'development'),
  },

  histogramBuckets: [
    0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
  ],
});
