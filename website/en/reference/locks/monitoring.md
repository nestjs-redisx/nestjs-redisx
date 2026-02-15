---
title: Monitoring
description: Metrics, logging, and debugging locks
---

# Monitoring

Track lock performance and debug issues.

## Available Metrics

When the `MetricsPlugin` is registered alongside `LocksPlugin`, the following Prometheus metrics are emitted automatically:

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `redisx_lock_acquisitions_total` | Counter | `status` (`acquired` \| `failed`) | Lock acquisition attempts |
| `redisx_lock_wait_duration_seconds` | Histogram | — | Time waiting to acquire a lock |
| `redisx_lock_hold_duration_seconds` | Histogram | — | How long a lock was held |
| `redisx_locks_active` | Gauge | — | Currently held locks |

### Prometheus Queries

```yaml
# Acquisition success rate
rate(redisx_lock_acquisitions_total{status="acquired"}[5m])
/ rate(redisx_lock_acquisitions_total[5m])

# Average wait time
rate(redisx_lock_wait_duration_seconds_sum[5m])
/ rate(redisx_lock_wait_duration_seconds_count[5m])

# Currently held locks
redisx_locks_active
```

## Custom Logging

Lock lifecycle events are tracked automatically via `MetricsPlugin` and `TracingPlugin`.
For custom logging, wrap the `LockService`:

<<< @/apps/demo/src/plugins/locks/monitoring-logging.usage.ts{typescript}

## Next Steps

- [Testing](./testing) — Test locked services
- [Troubleshooting](./troubleshooting) — Debug issues
