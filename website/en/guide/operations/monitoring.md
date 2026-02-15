---
title: Monitoring
description: Key metrics, dashboards, and SLOs for production monitoring
---

# Monitoring

Production monitoring setup for NestJS RedisX.

## Key Metrics by Component

### Cache Metrics

| Metric | Description | Good | Warning | Critical |
|--------|-------------|------|---------|----------|
| `cache_hit_rate` | Hits / Total | >90% | 80-90% | <80% |
| `cache_latency_p99` | 99th percentile | <5ms | 5-20ms | >20ms |
| `cache_eviction_rate` | Evictions/sec | Low | Increasing | Spiking |

### Lock Metrics

| Metric | Description | Good | Warning | Critical |
|--------|-------------|------|---------|----------|
| `lock_acquisition_time_p99` | Wait time | <100ms | 100-500ms | >500ms |
| `lock_timeout_rate` | Timeouts / Total | <1% | 1-5% | >5% |
| `lock_held_duration_p99` | Hold time | <TTL/2 | ~TTL | >TTL |

### Rate Limit Metrics

| Metric | Description | Good | Warning | Critical |
|--------|-------------|------|---------|----------|
| `ratelimit_rejection_rate` | Rejected / Total | <5% | 5-20% | >20% |
| `ratelimit_near_limit` | >80% of limit | <10% | 10-30% | >30% |

### Stream Metrics

| Metric | Description | Good | Warning | Critical |
|--------|-------------|------|---------|----------|
| `stream_consumer_lag` | Pending messages | <100 | 100-1000 | >1000 |
| `stream_dlq_size` | DLQ message count | 0 | 1-10 | >10 |
| `stream_processing_time_p99` | Handler time | <1s | 1-5s | >5s |

## PromQL Queries

### Cache Dashboard

```yaml
# Hit Rate
sum(rate(redisx_cache_hits_total[5m])) / 
(sum(rate(redisx_cache_hits_total[5m])) + sum(rate(redisx_cache_misses_total[5m])))

# Latency P99
histogram_quantile(0.99, sum(rate(redisx_cache_duration_seconds_bucket[5m])) by (le, operation))

# Operations per Second
sum(rate(redisx_cache_operations_total[5m])) by (operation)
```

### Lock Dashboard

```yaml
# Timeout Rate
sum(rate(redisx_lock_timeouts_total[5m])) / sum(rate(redisx_lock_attempts_total[5m]))

# Active Locks
redisx_locks_active

# Wait Time P99
histogram_quantile(0.99, sum(rate(redisx_lock_wait_seconds_bucket[5m])) by (le))
```

### Stream Dashboard

```yaml
# Consumer Lag
redisx_stream_consumer_lag{stream="jobs"}

# Processing Rate
sum(rate(redisx_stream_messages_processed_total[5m])) by (stream)

# DLQ Size
redisx_stream_length{stream=~".*:dlq"}
```

## Grafana Dashboard JSON

```json
{
  "title": "NestJS RedisX Overview",
  "panels": [
    {
      "title": "Cache Hit Rate",
      "type": "stat",
      "fieldConfig": {
        "defaults": {
          "thresholds": {
            "steps": [
              { "value": 0, "color": "red" },
              { "value": 0.8, "color": "yellow" },
              { "value": 0.9, "color": "green" }
            ]
          },
          "unit": "percentunit"
        }
      },
      "targets": [{
        "expr": "sum(rate(redisx_cache_hits_total[5m])) / (sum(rate(redisx_cache_hits_total[5m])) + sum(rate(redisx_cache_misses_total[5m])))"
      }]
    },
    {
      "title": "Lock Timeout Rate",
      "type": "stat",
      "targets": [{
        "expr": "sum(rate(redisx_lock_timeouts_total[5m])) / sum(rate(redisx_lock_attempts_total[5m]))"
      }]
    },
    {
      "title": "Stream Consumer Lag",
      "type": "graph",
      "targets": [{
        "expr": "redisx_stream_consumer_lag",
        "legendFormat": "{{stream}} - {{group}}"
      }]
    }
  ]
}
```

## SLOs

### Recommended SLOs

| Component | SLI | SLO |
|-----------|-----|-----|
| Cache | Hit rate | >90% over 7 days |
| Cache | Latency p99 | <10ms over 7 days |
| Locks | Timeout rate | <1% over 7 days |
| Streams | Lag | <1000 99% of time |
| Streams | DLQ size | 0 99% of time |

### Error Budget

```yaml
# Cache hit rate error budget burn
1 - (sum(rate(redisx_cache_hits_total[7d])) / 
     (sum(rate(redisx_cache_hits_total[7d])) + sum(rate(redisx_cache_misses_total[7d]))))
/ (1 - 0.90)  # SLO target
```

## Health Endpoints

```typescript
// health.controller.ts
@Controller('health')
export class HealthController {
  @Get('live')
  liveness() {
    return { status: 'ok' };
  }

  @Get('ready')
  async readiness() {
    const redis = await this.redis.ping();
    
    return {
      status: redis ? 'ok' : 'degraded',
      checks: {
        redis: redis ? 'ok' : 'failed',
      },
    };
  }
}
```

## Next Steps

- [Alerting](./alerting) — Configure alerts
- [Runbooks](./runbooks) — Incident response
