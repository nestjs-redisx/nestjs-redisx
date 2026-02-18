---
title: Configuration
description: Complete configuration reference for Metrics Plugin
---

# Configuration

Full reference for all Metrics Plugin options.

## Complete Options Reference

```typescript
new MetricsPlugin({
  // ─────────────────────────────────────────
  // Basic Settings
  // ─────────────────────────────────────────

  /**
   * Enable metrics collection
   * @default true
   */
  enabled: true,

  /**
   * Metrics prefix
   * @default 'redisx_'
   */
  prefix: 'myapp_redis_',

  /**
   * Default labels for all metrics
   */
  defaultLabels: {
    app: 'myapp',
    env: 'production',
  },

  // ─────────────────────────────────────────
  // Histogram Configuration
  // ─────────────────────────────────────────

  /**
   * Histogram buckets for latency (seconds)
   * @default [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
   */
  histogramBuckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],

  // ─────────────────────────────────────────
  // Endpoint Configuration
  // ─────────────────────────────────────────

  /**
   * Expose /metrics endpoint
   * @default true
   */
  exposeEndpoint: true,

  /**
   * Metrics endpoint path
   * @default '/metrics'
   * @remarks Reserved for future use. Currently always `/metrics`.
   */
  endpoint: '/metrics',

  // ─────────────────────────────────────────
  // Collection Settings
  // ─────────────────────────────────────────

  /**
   * Collect default Node.js metrics
   * @default true
   */
  collectDefaultMetrics: true,

  /**
   * Enable command-level metrics
   * @default true
   */
  commandMetrics: true,

  /**
   * Enable plugin metrics (cache, locks, etc)
   * @default true
   */
  pluginMetrics: true,

  /**
   * Collection interval for gauges (ms)
   * @default 15000
   */
  collectInterval: 15000,
})
```

::: info Endpoint Path
The `endpoint` option is reserved for future use. The metrics endpoint is currently always served at `/metrics`.
:::

## Configuration by Use Case

### Production

```typescript
new MetricsPlugin({
  enabled: true,
  prefix: 'myapp_',
  defaultLabels: {
    app: 'myapp',
    env: 'production',
    region: process.env.REGION,
  },
  collectDefaultMetrics: true,
  pluginMetrics: true,
})
```

### Development

```typescript
new MetricsPlugin({
  enabled: true,
  prefix: 'dev_',
  collectDefaultMetrics: false,  // Less noise
  collectInterval: 5000,         // More frequent
})
```

### Minimal (Low Overhead)

```typescript
new MetricsPlugin({
  enabled: true,
  commandMetrics: false,         // Skip per-command metrics
  pluginMetrics: false,          // Skip plugin metrics
  collectDefaultMetrics: false,
})
```

### High-Performance (Optimized Buckets)

```typescript
new MetricsPlugin({
  enabled: true,
  histogramBuckets: [
    0.001,  // 1ms
    0.01,   // 10ms
    0.1,    // 100ms
    1,      // 1s
  ],  // Fewer buckets = less overhead
})
```

## Environment Configuration

```typescript
// config/metrics.config.ts
import { registerAs } from '@nestjs/config';

export default registerAs('metrics', () => ({
  enabled: process.env.METRICS_ENABLED !== 'false',
  prefix: process.env.METRICS_PREFIX || 'redisx_',
  endpoint: process.env.METRICS_ENDPOINT || '/metrics',
  defaultLabels: {
    app: process.env.APP_NAME || 'myapp',
    env: process.env.NODE_ENV || 'development',
    region: process.env.REGION,
    version: process.env.APP_VERSION,
  },
}));
```

```bash
# .env
METRICS_ENABLED=true
METRICS_PREFIX=myapp_
METRICS_ENDPOINT=/metrics
APP_NAME=myapp
REGION=us-east-1
APP_VERSION=1.0.0
```

## Async Configuration

Using `process.env` directly in plugin constructor with `forRootAsync`:

<<< @/apps/demo/src/plugins/metrics/async-config.setup.ts{typescript}

### Using registerAsync with ConfigService

For type-safe configuration via NestJS DI:

<<< @/apps/demo/src/plugins/metrics/register-async.setup.ts{typescript}

## Histogram Bucket Guidelines

### Latency (Redis Commands)

```typescript
histogramBuckets: [
  0.001,   // 1ms   - Very fast
  0.005,   // 5ms   - Fast
  0.01,    // 10ms  - Normal
  0.025,   // 25ms  - Slow
  0.05,    // 50ms  - Very slow
  0.1,     // 100ms - Critical
  0.5,     // 500ms - Timeout territory
  1,       // 1s    - Major issue
]
```

### HTTP Requests

```typescript
histogramBuckets: [
  0.01,    // 10ms
  0.05,    // 50ms
  0.1,     // 100ms
  0.25,    // 250ms
  0.5,     // 500ms
  1,       // 1s
  2.5,     // 2.5s
  5,       // 5s
  10,      // 10s
]
```

### Background Jobs

```typescript
histogramBuckets: [
  1,       // 1s
  5,       // 5s
  10,      // 10s
  30,      // 30s
  60,      // 1min
  300,     // 5min
  600,     // 10min
]
```

## Default Labels

### Common Labels

```typescript
defaultLabels: {
  // Application identity
  app: 'myapp',
  service: 'api',

  // Environment
  env: process.env.NODE_ENV,
  region: process.env.REGION,
  zone: process.env.ZONE,

  // Version
  version: packageJson.version,

  // Infrastructure
  instance: process.env.HOSTNAME,
  pod: process.env.POD_NAME,
}
```

### Kubernetes Labels

```typescript
defaultLabels: {
  app: process.env.APP_NAME,
  namespace: process.env.NAMESPACE,
  pod: process.env.POD_NAME,
  node: process.env.NODE_NAME,
  cluster: process.env.CLUSTER_NAME,
}
```

## Conditional Configuration

### Disable in Tests

```typescript
new MetricsPlugin({
  enabled: process.env.NODE_ENV !== 'test',
})
```

### Different Prefixes per Environment

```typescript
const prefixMap = {
  production: 'prod_',
  staging: 'staging_',
  development: 'dev_',
};

new MetricsPlugin({
  prefix: prefixMap[process.env.NODE_ENV] || 'dev_',
})
```

### Feature Flags

```typescript
new MetricsPlugin({
  enabled: config.get('features.metrics.enabled'),
  commandMetrics: config.get('features.metrics.commands'),
  pluginMetrics: config.get('features.metrics.plugins'),
})
```

## Multi-Instance Configuration

### Load Balancer Setup

```typescript
// Instance 1
new MetricsPlugin({
  prefix: 'myapp_',
  defaultLabels: {
    instance: 'api-1',
  },
})

// Instance 2
new MetricsPlugin({
  prefix: 'myapp_',
  defaultLabels: {
    instance: 'api-2',
  },
})

// Aggregate in Prometheus:
// sum(myapp_redis_cache_hits_total) by (instance)
```

### Blue-Green Deployment

```typescript
new MetricsPlugin({
  prefix: 'myapp_',
  defaultLabels: {
    deployment: process.env.DEPLOYMENT_COLOR,  // 'blue' or 'green'
  },
})
```

## Performance Tuning

### Reduce Overhead

```typescript
new MetricsPlugin({
  // Disable expensive features
  collectDefaultMetrics: false,
  commandMetrics: false,

  // Increase collection interval
  collectInterval: 60000,  // 1 minute

  // Fewer buckets
  histogramBuckets: [0.01, 0.1, 1],
})
```

### High-Volume Workload

```typescript
new MetricsPlugin({
  // Keep only essential metrics
  commandMetrics: true,
  pluginMetrics: false,

  // Coarser granularity
  histogramBuckets: [0.01, 0.1, 1, 10],

  // Longer collection interval
  collectInterval: 30000,
})
```

## Validation

### Type-Safe Configuration

```typescript
import { IMetricsPluginOptions } from '@nestjs-redisx/metrics';

const config: IMetricsPluginOptions = {
  enabled: true,
  prefix: 'myapp_',
  histogramBuckets: [0.001, 0.01, 0.1, 1],
};

new MetricsPlugin(config);
```

### Runtime Validation

```typescript
import { validate } from 'class-validator';

class MetricsConfig {
  @IsBoolean()
  enabled: boolean;

  @IsString()
  @Matches(/^[a-z_]+$/)
  prefix: string;

  @IsArray()
  @ArrayMinSize(1)
  histogramBuckets: number[];
}

const config = new MetricsConfig();
config.enabled = true;
config.prefix = 'myapp_';
config.histogramBuckets = [0.001, 0.01, 0.1];

await validate(config);
```

## Next Steps

- [Prometheus](./prometheus) — Set up Prometheus scraping
- [Grafana](./grafana) — Create dashboards
- [Custom Metrics](./custom-metrics) — Add custom metrics
