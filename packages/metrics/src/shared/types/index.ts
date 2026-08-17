import type { Registry } from 'prom-client';

export interface IMetricsPluginOptions {
  /**
   * Make the module global.
   * @default false
   */
  isGlobal?: boolean;

  /**
   * Enable metrics collection.
   * @default true
   */
  enabled?: boolean;

  /**
   * Metrics prefix.
   * @default 'redisx_'
   */
  prefix?: string;

  /**
   * Default labels added to all metrics.
   *
   * With an external registry (`registry: 'default'` or a provided
   * instance), labels are only applied when this option is explicitly set —
   * the plugin never overwrites the application's default labels otherwise.
   */
  defaultLabels?: Record<string, string>;

  /**
   * Which prom-client registry to register metrics into.
   *
   * - `'own'` — an isolated registry, exposed via the plugin's `/metrics`
   *   endpoint and `getMetrics()`.
   * - `'default'` — the global `promClient.register`, so RedisX metrics show
   *   up on the application's existing `/metrics` endpoint.
   * - a `Registry` instance — register into the provided registry.
   *
   * With an external registry (`'default'` or an instance) the plugin only
   * removes its OWN metrics on shutdown and `collectDefaultMetrics` becomes
   * opt-in (the application almost certainly collects process metrics
   * already).
   * @default 'own'
   */
  registry?: 'own' | 'default' | Registry;

  /**
   * Histogram buckets for latency (in seconds).
   * @default [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
   */
  histogramBuckets?: number[];

  /**
   * Expose /metrics endpoint.
   * @default true
   */
  exposeEndpoint?: boolean;

  /**
   * Metrics endpoint path.
   * Note: NestJS `@Controller()` path is a compile-time constant.
   * This option is reserved for future use. The endpoint is always `/metrics`.
   * @default '/metrics'
   */
  endpoint?: string;

  /**
   * Collect default Node.js metrics.
   * @default true
   */
  collectDefaultMetrics?: boolean;

  /**
   * Enable detailed command metrics.
   * @default true
   */
  commandMetrics?: boolean;

  /**
   * Enable plugin-specific metrics (cache, locks, etc).
   * @default true
   */
  pluginMetrics?: boolean;

  /**
   * Collection interval for gauges (ms).
   * @default 15000
   */
  collectInterval?: number;
}

export interface IMetricsJson {
  name: string;
  help: string;
  type: string;
  values: Array<{
    labels: Record<string, string>;
    value: number;
  }>;
}
