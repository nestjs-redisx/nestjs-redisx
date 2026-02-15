---
title: Monitoring
description: Metrics, logging, and debugging cache performance
---

# Monitoring

Track cache performance and debug issues.

## Cache Statistics

The `getStats()` method returns cumulative cache metrics since application startup:

```typescript
const stats = await cache.getStats();

/*
{
  l1: {
    hits: 15234,       // L1 cache hits (cumulative)
    misses: 1876,      // L1 cache misses (cumulative)
    size: 523,         // Current entries in L1
  },
  l2: {
    hits: 45123,       // L2 cache hits (cumulative)
    misses: 2341,      // L2 cache misses (cumulative)
  },
  stampedePrevented: 142,  // Total stampede events prevented (cumulative)
}
*/
```

::: info Counters are cumulative
`hits`, `misses`, and `stampedePrevented` are **cumulative counters** — they grow from zero at application startup and never reset. To calculate rates, take the delta between two snapshots over time.
:::

### Available Metrics

| Metric | Type | Source | Description |
|--------|------|--------|-------------|
| `l1.hits` | Counter | L1 adapter `get()` | Entry found and not expired |
| `l1.misses` | Counter | L1 adapter `get()` | Entry not found, or expired on access |
| `l1.size` | Gauge | L1 adapter | Current number of entries in memory |
| `l2.hits` | Counter | L2 adapter `get()`, `getMany()`, `getSwr()` | Entry found in Redis |
| `l2.misses` | Counter | L2 adapter `get()`, `getMany()`, `getSwr()` | Entry not found, or Redis error (fail-open) |
| `stampedePrevented` | Counter | Stampede service `protect()` | Concurrent request waited instead of loading |

### What's NOT in getStats()

The public `getStats()` returns `CacheStats` which is a subset of all available stats:

| Stats | Available in `getStats()`? | How to access |
|-------|---------------------------|---------------|
| SWR `activeRevalidations`, `enabled`, `staleTtl` | No | `@Inject(SWR_MANAGER)` → `.getStats()` |
| Stampede `activeFlights`, `totalWaiters`, `oldestFlight` | No (only `prevented`) | `@Inject(STAMPEDE_PROTECTION)` → `.getStats()` |

<<< @/apps/demo/src/plugins/cache/monitoring-detailed-stats.usage.ts{typescript}

## Calculate Hit Rates

<<< @/apps/demo/src/plugins/cache/monitoring-hit-rates.usage.ts{typescript}

## Built-in Metrics & Tracing Integration

The internal cache service has **optional** integration with `MetricsPlugin` and `TracingPlugin`. When these plugins are registered, metrics and traces are collected automatically — no custom code needed.

### MetricsPlugin (automatic)

If `MetricsPlugin` is registered, the cache service automatically increments these Prometheus counters:

| Metric name | Labels | When |
|-------------|--------|------|
| `redisx_cache_hits_total` | `layer: 'l1'` | L1 cache hit |
| `redisx_cache_misses_total` | `layer: 'l1'` | L1 cache miss |
| `redisx_cache_hits_total` | `layer: 'l2'` | L2 cache hit |
| `redisx_cache_misses_total` | `layer: 'l2'` | L2 cache miss |
| `redisx_cache_stampede_prevented_total` | — | Stampede prevention event |

<<< @/apps/demo/src/plugins/cache/metrics-plugin.setup.ts{typescript}

### TracingPlugin (automatic)

If `TracingPlugin` is registered, the cache service automatically creates OpenTelemetry spans:

| Span name | Attributes | When |
|-----------|------------|------|
| `cache.get` | `cache.key` | Every `get()` call |
| `cache.set` | `cache.key`, `cache.ttl` | Every `set()` call |

```typescript
plugins: [
  new CachePlugin({ l1: { maxSize: 1000 } }),
  new TracingPlugin(),  // Enables automatic span creation
],
```

::: info Optional injection
Both integrations use `@Optional() @Inject()` — if the plugin is not registered, the cache works normally without metrics or traces.
:::

## Custom Prometheus (without MetricsPlugin)

If you prefer manual Prometheus integration with `prom-client` instead of `MetricsPlugin`:

<<< @/apps/demo/src/plugins/cache/cache-metrics-service.usage.ts{typescript}

::: warning Gauges, not Counters
Use `Gauge` for hit rates and sizes derived from cumulative stats. If you need `Counter` for hits/misses, calculate the **delta** between snapshots — don't pass cumulative values to `Counter.inc()`.
:::

## Grafana Queries

Example PromQL queries (when using `MetricsPlugin`):

```yaml
# L1 hit rate (over 5 minutes)
rate(redisx_cache_hits_total{layer="l1"}[5m])
  / (rate(redisx_cache_hits_total{layer="l1"}[5m]) + rate(redisx_cache_misses_total{layer="l1"}[5m]))

# L2 hit rate (over 5 minutes)
rate(redisx_cache_hits_total{layer="l2"}[5m])
  / (rate(redisx_cache_hits_total{layer="l2"}[5m]) + rate(redisx_cache_misses_total{layer="l2"}[5m]))

# Stampede prevention rate
rate(redisx_cache_stampede_prevented_total[5m])
```

## Logging

The cache service uses NestJS `Logger` internally. Key log messages:

| Service | Level | Message |
|---------|-------|---------|
| `WarmupService` | LOG | `Starting cache warmup for N keys...` |
| `WarmupService` | LOG | `Cache warmup completed: X succeeded, Y failed (Zms)` |
| `SwrManagerService` | DEBUG | `Starting revalidation for key: {key}` |
| `SwrManagerService` | ERROR | `Revalidation failed for key: {key}` |
| `StampedeProtectionService` | WARN | `Failed to acquire distributed lock: ...` |
| `CacheService` | WARN | `Invalid cache key "{key}": ...` |

To see DEBUG logs, configure NestJS log level:

```typescript
const app = await NestFactory.create(AppModule, {
  logger: ['log', 'error', 'warn', 'debug'],
});
```

## Next Steps

- [Testing](./testing) — Test cached services
- [Troubleshooting](./troubleshooting) — Debug common issues
