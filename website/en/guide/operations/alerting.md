---
title: Alerting
description: Alert rules and thresholds for NestJS RedisX
---

# Alerting

Configure alerts to catch issues before they impact users.

## Alert Philosophy

1. **Alert on symptoms, not causes** — Page for user impact
2. **Avoid alert fatigue** — Only alert on actionable items
3. **Include runbook links** — Make alerts actionable

## Prometheus Alert Rules

```yaml
# alerts.yml
groups:
  - name: redisx-critical
    rules:
      # Redis Connection
      - alert: RedisConnectionLost
        expr: redis_up == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Redis connection lost"
          runbook: "https://docs.example.com/runbooks/redis-connection"

      # Cache
      - alert: CacheHitRateCritical
        expr: |
          sum(rate(redisx_cache_hits_total[5m])) / 
          (sum(rate(redisx_cache_hits_total[5m])) + sum(rate(redisx_cache_misses_total[5m]))) < 0.7
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Cache hit rate below 70%"

      # Locks
      - alert: LockTimeoutRateCritical
        expr: |
          rate(redisx_lock_timeouts_total[5m]) / rate(redisx_lock_attempts_total[5m]) > 0.1
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Lock timeout rate above 10%"

      # Streams
      - alert: StreamConsumerLagCritical
        expr: redisx_stream_consumer_lag > 10000
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Stream consumer lag above 10000"

  - name: redisx-warning
    rules:
      - alert: CacheHitRateLow
        expr: |
          sum(rate(redisx_cache_hits_total[5m])) / 
          (sum(rate(redisx_cache_hits_total[5m])) + sum(rate(redisx_cache_misses_total[5m]))) < 0.85
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Cache hit rate below 85%"

      - alert: LockContentionHigh
        expr: |
          histogram_quantile(0.99, rate(redisx_lock_wait_seconds_bucket[5m])) > 0.5
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Lock wait time p99 above 500ms"

      - alert: DLQNotEmpty
        expr: redisx_stream_length{stream=~".*:dlq"} > 0
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Dead letter queue has messages"

      - alert: RateLimitRejectionHigh
        expr: |
          rate(redisx_ratelimit_rejected_total[5m]) / 
          (rate(redisx_ratelimit_allowed_total[5m]) + rate(redisx_ratelimit_rejected_total[5m])) > 0.2
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Rate limit rejection rate above 20%"
```

## Alert Routing

```yaml
# alertmanager.yml
route:
  receiver: 'default'
  routes:
    - match:
        severity: critical
      receiver: 'pagerduty'
      continue: true
    - match:
        severity: warning
      receiver: 'slack'

receivers:
  - name: 'pagerduty'
    pagerduty_configs:
      - service_key: '<key>'

  - name: 'slack'
    slack_configs:
      - api_url: '<webhook>'
        channel: '#alerts'
```

## Alert Thresholds

| Alert | Warning | Critical |
|-------|---------|----------|
| Cache hit rate | <85% | <70% |
| Lock timeout rate | >5% | >10% |
| Lock wait p99 | >500ms | >2s |
| Consumer lag | >1000 | >10000 |
| DLQ size | >0 | >100 |
| Rate limit rejection | >10% | >30% |

## Testing Alerts

```bash
# Trigger test alert
curl -X POST http://alertmanager:9093/api/v1/alerts \
  -H "Content-Type: application/json" \
  -d '[{
    "labels": {
      "alertname": "TestAlert",
      "severity": "warning"
    },
    "annotations": {
      "summary": "Test alert"
    }
  }]'
```

## Next Steps

- [Monitoring](./monitoring) — Metrics setup
- [Runbooks](./runbooks) — Incident response
