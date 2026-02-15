/**
 * @fileoverview Distributed tracing plugin configuration.
 */

import { ConfigService } from '@nestjs/config';
import { ITracingPluginOptions } from '@nestjs-redisx/tracing';

export const tracingConfig = (): ITracingPluginOptions => ({
  enabled: process.env.TRACING_ENABLED !== 'false',
  serviceName: process.env.OTEL_SERVICE_NAME || 'redisx-example',

  exporter: {
    type: 'otlp',
    endpoint:
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
      'http://localhost:4318/v1/traces',
  },

  sampling: {
    strategy: (process.env.TRACING_SAMPLING || 'always') as
      | 'always'
      | 'never'
      | 'ratio'
      | 'parent',
    ratio: 1.0,
  },
});
