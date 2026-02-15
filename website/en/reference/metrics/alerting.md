---
title: Alerting
description: Set up alerts for Redis and application metrics
---

# Alerting

Configure alerts to get notified when metrics exceed thresholds.

## AlertManager Setup

### Install AlertManager

```yaml
# docker-compose.yml
version: '3.8'

services:
  alertmanager:
    image: prom/alertmanager:latest
    ports:
      - "9093:9093"
    volumes:
      - ./alertmanager.yml:/etc/alertmanager/alertmanager.yml
      - alertmanager-data:/alertmanager
    command:
      - '--config.file=/etc/alertmanager/alertmanager.yml'
      - '--storage.path=/alertmanager'

volumes:
  alertmanager-data:
```

### Configure AlertManager

```yaml
# alertmanager.yml
global:
  resolve_timeout: 5m
  slack_api_url: 'https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK'

route:
  group_by: ['alertname', 'severity']
  group_wait: 10s
  group_interval: 10s
  repeat_interval: 12h
  receiver: 'slack-notifications'
  routes:
    - match:
        severity: critical
      receiver: 'pagerduty'
    - match:
        severity: warning
      receiver: 'slack-notifications'

receivers:
  - name: 'slack-notifications'
    slack_configs:
      - channel: '#alerts'
        title: '{{ .GroupLabels.alertname }}'
        text: '{{ range .Alerts }}{{ .Annotations.summary }}{{ end }}'

  - name: 'pagerduty'
    pagerduty_configs:
      - service_key: 'YOUR_PAGERDUTY_KEY'
```

## Alert Rules

### Redis Performance Alerts

```yaml
# prometheus/rules/redis.yml
groups:
  - name: redis_alerts
    interval: 15s
    rules:
      # High latency
      - alert: HighRedisLatency
        expr: |
          histogram_quantile(0.95,
            rate(myapp_redis_command_duration_seconds_bucket[5m])
          ) > 0.05
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High Redis latency detected"
          description: "P95 latency is {{ $value }}s (threshold: 0.05s)"

      # High error rate
      - alert: HighRedisErrorRate
        expr: |
          sum(rate(myapp_redis_errors_total[5m])) /
          sum(rate(myapp_redis_commands_total[5m])) > 0.01
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High Redis error rate"
          description: "Error rate is {{ $value | humanizePercentage }} (threshold: 1%)"

      # Redis down
      - alert: RedisDown
        expr: up{job="redis"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Redis is down"
          description: "Redis instance {{ $labels.instance }} is unreachable"
```

### Cache Alerts

```yaml
groups:
  - name: cache_alerts
    rules:
      # Low hit rate
      - alert: LowCacheHitRate
        expr: |
          sum(rate(myapp_redis_cache_hits_total[5m])) /
          (
            sum(rate(myapp_redis_cache_hits_total[5m])) +
            sum(rate(myapp_redis_cache_misses_total[5m]))
          ) < 0.7
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Cache hit rate is low"
          description: "Hit rate is {{ $value | humanizePercentage }} for layer {{ $labels.layer }}"

      # Cache full
      - alert: CacheFull
        expr: myapp_redis_cache_size > 50000
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Cache is nearly full"
          description: "Cache size is {{ $value }} (threshold: 50000)"
```

### Lock Alerts

```yaml
groups:
  - name: lock_alerts
    rules:
      # High lock contention
      - alert: HighLockContention
        expr: myapp_redis_locks_active > 100
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High lock contention"
          description: "{{ $value }} active locks (threshold: 100)"

      # Long lock wait time
      - alert: LongLockWaitTime
        expr: |
          histogram_quantile(0.95,
            rate(myapp_redis_lock_wait_duration_seconds_bucket[5m])
          ) > 1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Long lock wait times"
          description: "P95 wait time is {{ $value }}s (threshold: 1s)"

      # Lock acquisition failures
      - alert: LockAcquisitionFailures
        expr: |
          sum(rate(myapp_redis_lock_acquisitions_total{status="failed"}[5m])) > 10
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High lock acquisition failure rate"
          description: "{{ $value }} failures/sec"
```

### Stream Alerts

```yaml
groups:
  - name: stream_alerts
    rules:
      # Processing errors
      - alert: StreamProcessingErrors
        expr: |
          sum(rate(myapp_redis_stream_messages_consumed_total{status="error"}[5m])) /
          sum(rate(myapp_redis_stream_messages_consumed_total[5m])) > 0.05
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High stream processing error rate"
          description: "{{ $value | humanizePercentage }} errors for {{ $labels.stream }}"

      # Publish errors
      - alert: StreamPublishErrors
        expr: |
          sum(rate(myapp_redis_stream_publish_errors_total[5m])) > 1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Stream publish errors detected"
          description: "{{ $value }} publish errors/sec for {{ $labels.stream }}"
```

### Rate Limit Alerts

```yaml
groups:
  - name: rate_limit_alerts
    rules:
      # High block rate
      - alert: HighRateLimitBlockRate
        expr: |
          sum(rate(myapp_redis_ratelimit_requests_total{status="rejected"}[5m])) /
          sum(rate(myapp_redis_ratelimit_requests_total[5m])) > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High rate limit block rate"
          description: "{{ $value | humanizePercentage }} of requests blocked"
```

## Application Alerts

### API Health

```yaml
groups:
  - name: api_alerts
    rules:
      # High error rate
      - alert: HighAPIErrorRate
        expr: |
          sum(rate(http_requests_total{status=~"5.."}[5m])) /
          sum(rate(http_requests_total[5m])) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High API error rate"
          description: "{{ $value | humanizePercentage }} error rate"

      # Slow response times
      - alert: SlowAPIResponses
        expr: |
          histogram_quantile(0.95,
            rate(http_request_duration_seconds_bucket[5m])
          ) > 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Slow API responses"
          description: "P95 latency is {{ $value }}s"

      # High request rate
      - alert: HighRequestRate
        expr: |
          sum(rate(http_requests_total[5m])) > 10000
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Very high request rate"
          description: "{{ $value }} requests/sec"
```

### System Resources

```yaml
groups:
  - name: system_alerts
    rules:
      # High CPU
      - alert: HighCPUUsage
        expr: |
          100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 80
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High CPU usage"
          description: "CPU usage is {{ $value }}%"

      # High memory
      - alert: HighMemoryUsage
        expr: |
          (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100 > 80
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High memory usage"
          description: "Memory usage is {{ $value }}%"

      # Disk full
      - alert: DiskSpaceLow
        expr: |
          (1 - (node_filesystem_avail_bytes / node_filesystem_size_bytes)) * 100 > 85
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Disk space running low"
          description: "Disk usage is {{ $value }}% on {{ $labels.mountpoint }}"
```

## Notification Channels

### Slack

```yaml
receivers:
  - name: 'slack'
    slack_configs:
      - api_url: 'https://hooks.slack.com/services/YOUR/WEBHOOK'
        channel: '#alerts'
        title: 'Alert: {{ .GroupLabels.alertname }}'
        text: |
          {{ range .Alerts }}
          *Summary:* {{ .Annotations.summary }}
          *Description:* {{ .Annotations.description }}
          *Severity:* {{ .Labels.severity }}
          {{ end }}
        send_resolved: true
```

### PagerDuty

```yaml
receivers:
  - name: 'pagerduty'
    pagerduty_configs:
      - service_key: 'YOUR_PAGERDUTY_INTEGRATION_KEY'
        description: '{{ .GroupLabels.alertname }}: {{ .Annotations.summary }}'
```

### Email

```yaml
receivers:
  - name: 'email'
    email_configs:
      - to: 'team@example.com'
        from: 'alerts@example.com'
        smarthost: 'smtp.gmail.com:587'
        auth_username: 'alerts@example.com'
        auth_password: 'password'
        headers:
          Subject: 'Alert: {{ .GroupLabels.alertname }}'
```

### Webhook

```yaml
receivers:
  - name: 'webhook'
    webhook_configs:
      - url: 'https://your-webhook-endpoint.com/alerts'
        send_resolved: true
```

## Alert Routing

### By Severity

```yaml
route:
  routes:
    # Critical → PagerDuty
    - match:
        severity: critical
      receiver: 'pagerduty'
      group_wait: 10s
      group_interval: 5m
      repeat_interval: 4h

    # Warning → Slack
    - match:
        severity: warning
      receiver: 'slack'
      group_wait: 30s
      group_interval: 10m
      repeat_interval: 12h
```

### By Team

```yaml
route:
  routes:
    # Backend team
    - match:
        team: backend
      receiver: 'backend-slack'

    # Infrastructure team
    - match:
        team: infrastructure
      receiver: 'infra-pagerduty'
```

## Silencing Alerts

### CLI

```bash
# Silence for 1 hour
amtool silence add \
  alertname=HighRedisLatency \
  --duration=1h \
  --comment="Planned maintenance"

# List silences
amtool silence query

# Expire silence
amtool silence expire <silence-id>
```

### API

```bash
# Create silence
curl -X POST http://localhost:9093/api/v2/silences \
  -H "Content-Type: application/json" \
  -d '{
    "matchers": [
      {
        "name": "alertname",
        "value": "HighRedisLatency",
        "isRegex": false
      }
    ],
    "startsAt": "2025-01-28T10:00:00Z",
    "endsAt": "2025-01-28T11:00:00Z",
    "createdBy": "admin",
    "comment": "Planned maintenance"
  }'
```

## Testing Alerts

```bash
# Trigger test alert
curl -X POST http://localhost:9093/api/v1/alerts \
  -H "Content-Type: application/json" \
  -d '[{
    "labels": {
      "alertname": "TestAlert",
      "severity": "warning"
    },
    "annotations": {
      "summary": "This is a test alert"
    }
  }]'
```

## Best Practices

**1. Set appropriate thresholds**

**2. Use `for` duration to avoid flapping**

**3. Group related alerts**

**4. Add clear descriptions**

**5. Route by severity**

**6. Test alert delivery**

**7. Document escalation procedures**

## Next Steps

- [Grafana](./grafana) — Visualize metrics
- [Troubleshooting](./troubleshooting) — Debug alerts
- [Overview](./index) — Back to overview
