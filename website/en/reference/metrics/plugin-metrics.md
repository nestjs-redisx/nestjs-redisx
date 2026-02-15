---
title: Plugin Metrics
description: Metrics automatically collected from other plugins
---

# Plugin Metrics

Metrics automatically collected from Cache, Locks, Rate Limit, Streams, and Idempotency plugins.

## Cache Plugin Metrics

### Cache Hits/Misses

```yaml
# HELP redisx_cache_hits_total Total cache hits
# TYPE redisx_cache_hits_total counter
redisx_cache_hits_total{layer="l1"} 15234
redisx_cache_hits_total{layer="l2"} 8932

# HELP redisx_cache_misses_total Total cache misses
# TYPE redisx_cache_misses_total counter
redisx_cache_misses_total{layer="l1"} 892
redisx_cache_misses_total{layer="l2"} 445
```

**Query: Cache Hit Rate**

```yaml
sum(rate(redisx_cache_hits_total[5m])) /
(
  sum(rate(redisx_cache_hits_total[5m])) +
  sum(rate(redisx_cache_misses_total[5m]))
) * 100
```

### Cache Hit Ratio

```yaml
# HELP redisx_cache_hit_ratio Cache hit ratio (0-1)
# TYPE redisx_cache_hit_ratio gauge
redisx_cache_hit_ratio{layer="l1"} 0.94
redisx_cache_hit_ratio{layer="l2"} 0.87
```

### Cache Size

```yaml
# HELP redisx_cache_size Current cache size
# TYPE redisx_cache_size gauge
redisx_cache_size{layer="l1"} 1024
redisx_cache_size{layer="l2"} 50000
```

### Cache Stampede Prevention

```yaml
# HELP redisx_cache_stampede_prevented_total Total cache stampede prevention activations
# TYPE redisx_cache_stampede_prevented_total counter
redisx_cache_stampede_prevented_total 42
```

## Lock Plugin Metrics

### Lock Acquisitions

```yaml
# HELP redisx_lock_acquisitions_total Total lock acquisition attempts
# TYPE redisx_lock_acquisitions_total counter
redisx_lock_acquisitions_total{status="acquired"} 456
redisx_lock_acquisitions_total{status="failed"} 23
```

**Query: Lock Failure Rate**

```yaml
sum(rate(redisx_lock_acquisitions_total{status="failed"}[5m])) /
sum(rate(redisx_lock_acquisitions_total[5m])) * 100
```

### Active Locks

```yaml
# HELP redisx_locks_active Number of currently held locks
# TYPE redisx_locks_active gauge
redisx_locks_active 12
```

### Lock Wait Duration

```yaml
# HELP redisx_lock_wait_duration_seconds Lock wait time in seconds
# TYPE redisx_lock_wait_duration_seconds histogram
redisx_lock_wait_duration_seconds_bucket{le="0.01"} 234
redisx_lock_wait_duration_seconds_bucket{le="0.1"} 445
redisx_lock_wait_duration_seconds_sum 45.2
redisx_lock_wait_duration_seconds_count 456
```

**Query: P95 Lock Wait Time**

```yaml
histogram_quantile(0.95,
  sum(rate(redisx_lock_wait_duration_seconds_bucket[5m])) by (le)
)
```

### Lock Hold Duration

```yaml
# HELP redisx_lock_hold_duration_seconds Lock hold time in seconds
# TYPE redisx_lock_hold_duration_seconds histogram
redisx_lock_hold_duration_seconds_bucket{le="0.1"} 300
redisx_lock_hold_duration_seconds_bucket{le="1"} 445
redisx_lock_hold_duration_seconds_sum 78.3
redisx_lock_hold_duration_seconds_count 456
```

## Rate Limit Plugin Metrics

### Rate Limit Requests

```yaml
# HELP redisx_ratelimit_requests_total Total rate limit requests
# TYPE redisx_ratelimit_requests_total counter
redisx_ratelimit_requests_total{status="allowed"} 1523
redisx_ratelimit_requests_total{status="rejected"} 45
```

**Query: Block Rate**

```yaml
sum(rate(redisx_ratelimit_requests_total{status="rejected"}[5m])) /
sum(rate(redisx_ratelimit_requests_total[5m])) * 100
```

## Streams Plugin Metrics

### Messages Published

```yaml
# HELP redisx_stream_messages_published_total Total stream messages published
# TYPE redisx_stream_messages_published_total counter
redisx_stream_messages_published_total{stream="orders"} 50234
```

### Messages Consumed

```yaml
# HELP redisx_stream_messages_consumed_total Total stream messages consumed
# TYPE redisx_stream_messages_consumed_total counter
redisx_stream_messages_consumed_total{stream="orders",group="processors",status="success"} 49823
redisx_stream_messages_consumed_total{stream="orders",group="processors",status="error"} 123
redisx_stream_messages_consumed_total{stream="orders",group="processors",status="retry"} 89
redisx_stream_messages_consumed_total{stream="orders",group="processors",status="dead_letter"} 7
```

**Status values:**

| Status | Description |
|--------|-------------|
| `success` | Message processed and ACKed |
| `error` | Handler threw an error |
| `retry` | Failed but retried (re-added to stream with incremented `_attempt`) |
| `dead_letter` | Max retries exhausted, moved to DLQ |

### Publish Duration

```yaml
# HELP redisx_stream_publish_duration_seconds Stream publish latency in seconds
# TYPE redisx_stream_publish_duration_seconds histogram
redisx_stream_publish_duration_seconds_bucket{stream="orders",le="0.001"} 40000
redisx_stream_publish_duration_seconds_bucket{stream="orders",le="0.01"} 49500
redisx_stream_publish_duration_seconds_sum{stream="orders"} 125.8
redisx_stream_publish_duration_seconds_count{stream="orders"} 50234
```

### Publish Errors

```yaml
# HELP redisx_stream_publish_errors_total Total stream publish errors
# TYPE redisx_stream_publish_errors_total counter
redisx_stream_publish_errors_total{stream="orders"} 12
```

### Processing Duration

```yaml
# HELP redisx_stream_processing_duration_seconds Stream message processing time in seconds
# TYPE redisx_stream_processing_duration_seconds histogram
redisx_stream_processing_duration_seconds_bucket{stream="orders",group="processors",le="0.1"} 234
redisx_stream_processing_duration_seconds_bucket{stream="orders",group="processors",le="1"} 445
redisx_stream_processing_duration_seconds_sum{stream="orders",group="processors"} 523.4
redisx_stream_processing_duration_seconds_count{stream="orders",group="processors"} 456
```

**Query: Processing Error Rate**

```yaml
sum(rate(redisx_stream_messages_consumed_total{status="error"}[5m])) /
sum(rate(redisx_stream_messages_consumed_total[5m])) * 100
```

## Idempotency Plugin Metrics

### Idempotent Requests

```yaml
# HELP redisx_idempotency_requests_total Total idempotency requests
# TYPE redisx_idempotency_requests_total counter
redisx_idempotency_requests_total{status="new"} 15234
redisx_idempotency_requests_total{status="replay"} 812
redisx_idempotency_requests_total{status="mismatch"} 80
```

**Query: Replay Rate**

```yaml
sum(rate(redisx_idempotency_requests_total{status="replay"}[5m])) /
sum(rate(redisx_idempotency_requests_total[5m])) * 100
```

### Idempotency Check Duration

```yaml
# HELP redisx_idempotency_duration_seconds Idempotency check duration in seconds
# TYPE redisx_idempotency_duration_seconds histogram
redisx_idempotency_duration_seconds_bucket{le="0.001"} 14000
redisx_idempotency_duration_seconds_bucket{le="0.01"} 15800
redisx_idempotency_duration_seconds_sum 32.5
redisx_idempotency_duration_seconds_count 16126
```

## Dashboards by Plugin

### Cache Dashboard

```json
{
  "panels": [
    {
      "title": "Cache Hit Rate",
      "targets": [{
        "expr": "sum(rate(redisx_cache_hits_total[5m])) / (sum(rate(redisx_cache_hits_total[5m])) + sum(rate(redisx_cache_misses_total[5m]))) * 100"
      }]
    },
    {
      "title": "Cache Size",
      "targets": [{
        "expr": "sum(redisx_cache_size) by (layer)"
      }]
    },
    {
      "title": "Stampede Preventions",
      "targets": [{
        "expr": "rate(redisx_cache_stampede_prevented_total[5m])"
      }]
    }
  ]
}
```

### Locks Dashboard

```json
{
  "panels": [
    {
      "title": "Active Locks",
      "targets": [{
        "expr": "redisx_locks_active"
      }]
    },
    {
      "title": "Lock Acquisition Rate",
      "targets": [{
        "expr": "sum(rate(redisx_lock_acquisitions_total[5m])) by (status)"
      }]
    },
    {
      "title": "P95 Wait Time",
      "targets": [{
        "expr": "histogram_quantile(0.95, sum(rate(redisx_lock_wait_duration_seconds_bucket[5m])) by (le))"
      }]
    }
  ]
}
```

### Streams Dashboard

```json
{
  "panels": [
    {
      "title": "Published Rate",
      "targets": [{
        "expr": "sum(rate(redisx_stream_messages_published_total[5m])) by (stream)"
      }]
    },
    {
      "title": "Consumed Rate",
      "targets": [{
        "expr": "sum(rate(redisx_stream_messages_consumed_total{status=\"success\"}[5m])) by (stream)"
      }]
    },
    {
      "title": "Processing Errors",
      "targets": [{
        "expr": "sum(rate(redisx_stream_messages_consumed_total{status=\"error\"}[5m])) by (stream)"
      }]
    }
  ]
}
```

## Alert Examples

### Cache Hit Rate Low

```yaml
- alert: LowCacheHitRate
  expr: |
    sum(rate(redisx_cache_hits_total[5m])) /
    (sum(rate(redisx_cache_hits_total[5m])) + sum(rate(redisx_cache_misses_total[5m]))) < 0.7
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Cache hit rate is below 70%"
```

### High Lock Contention

```yaml
- alert: HighLockContention
  expr: redisx_locks_active > 100
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "High number of active locks"
```

### Stream Processing Errors

```yaml
- alert: HighStreamErrorRate
  expr: |
    sum(rate(redisx_stream_messages_consumed_total{status="error"}[5m])) /
    sum(rate(redisx_stream_messages_consumed_total[5m])) > 0.05
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "High stream processing error rate"
```

## Next Steps

- [Custom Metrics](./custom-metrics) — Add your own metrics
- [Grafana](./grafana) — Visualize plugin metrics
- [Alerting](./alerting) — Set up alerts
