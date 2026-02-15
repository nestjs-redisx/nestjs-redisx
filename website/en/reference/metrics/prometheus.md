---
title: Prometheus Integration
description: Configure Prometheus to scrape metrics
---

# Prometheus Integration

Set up Prometheus to collect metrics from your NestJS application.

## Prometheus Configuration

### Basic Scrape Config

```yaml
# prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'nestjs-app'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/metrics'
    scrape_interval: 15s
```

### Multiple Instances

```yaml
scrape_configs:
  - job_name: 'nestjs-api'
    static_configs:
      - targets:
          - 'api-1:3000'
          - 'api-2:3000'
          - 'api-3:3000'
        labels:
          env: 'production'
          region: 'us-east-1'
```

### File-Based Service Discovery

```yaml
scrape_configs:
  - job_name: 'nestjs-app'
    file_sd_configs:
      - files:
          - 'targets/*.json'
        refresh_interval: 30s
```

```json
// targets/api.json
[
  {
    "targets": ["api-1:3000", "api-2:3000"],
    "labels": {
      "job": "api",
      "env": "production"
    }
  }
]
```

## Kubernetes Service Discovery

### ServiceMonitor (Prometheus Operator)

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: nestjs-api
  namespace: monitoring
spec:
  selector:
    matchLabels:
      app: nestjs-api
  endpoints:
    - port: http
      path: /metrics
      interval: 15s
```

### Annotations-Based Discovery

```yaml
# deployment.yaml
apiVersion: v1
kind: Service
metadata:
  name: nestjs-api
  annotations:
    prometheus.io/scrape: "true"
    prometheus.io/port: "3000"
    prometheus.io/path: "/metrics"
spec:
  selector:
    app: nestjs-api
  ports:
    - port: 3000
      name: http
```

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'kubernetes-pods'
    kubernetes_sd_configs:
      - role: pod
    relabel_configs:
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
        action: keep
        regex: true
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_path]
        action: replace
        target_label: __metrics_path__
        regex: (.+)
      - source_labels: [__address__, __meta_kubernetes_pod_annotation_prometheus_io_port]
        action: replace
        target_label: __address__
        regex: ([^:]+)(?::\d+)?;(\d+)
        replacement: $1:$2
```

## Docker Compose Setup

```yaml
# docker-compose.yml
version: '3.8'

services:
  app:
    image: myapp:latest
    ports:
      - "3000:3000"
    environment:
      - METRICS_ENABLED=true

  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus-data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--web.console.libraries=/usr/share/prometheus/console_libraries'
      - '--web.console.templates=/usr/share/prometheus/consoles'

volumes:
  prometheus-data:
```

## Authentication

### Basic Auth

```yaml
scrape_configs:
  - job_name: 'nestjs-api'
    static_configs:
      - targets: ['api:3000']
    basic_auth:
      username: 'prometheus'
      password: 'secret'
```

```typescript
// Add auth to metrics endpoint
import { NestFactory } from '@nestjs/core';
import * as basicAuth from 'express-basic-auth';

const app = await NestFactory.create(AppModule);

app.use('/metrics', basicAuth({
  users: { prometheus: 'secret' },
  challenge: true,
}));
```

### Bearer Token

```yaml
scrape_configs:
  - job_name: 'nestjs-api'
    static_configs:
      - targets: ['api:3000']
    bearer_token: 'your-secret-token'
```

## TLS/HTTPS

```yaml
scrape_configs:
  - job_name: 'nestjs-api'
    scheme: https
    tls_config:
      ca_file: /path/to/ca.crt
      cert_file: /path/to/client.crt
      key_file: /path/to/client.key
      insecure_skip_verify: false
    static_configs:
      - targets: ['api:3000']
```

## Remote Write

Send metrics to remote Prometheus instance:

```yaml
# prometheus.yml
remote_write:
  - url: https://prometheus-remote.example.com/api/v1/write
    basic_auth:
      username: 'user'
      password: 'pass'
```

## Recording Rules

Pre-calculate expensive queries:

```yaml
# rules/redis.yml
groups:
  - name: redis_rules
    interval: 15s
    rules:
      # Cache hit rate
      - record: redis:cache:hit_rate
        expr: |
          sum(rate(myapp_redis_cache_hits_total[5m])) /
          (
            sum(rate(myapp_redis_cache_hits_total[5m])) +
            sum(rate(myapp_redis_cache_misses_total[5m]))
          )

      # P95 command latency
      - record: redis:command:latency:p95
        expr: |
          histogram_quantile(0.95,
            rate(myapp_redis_command_duration_seconds_bucket[5m])
          )

      # Error rate
      - record: redis:command:error_rate
        expr: |
          sum(rate(myapp_redis_errors_total[5m])) /
          sum(rate(myapp_redis_commands_total[5m]))
```

Load rules in Prometheus:

```yaml
# prometheus.yml
rule_files:
  - 'rules/*.yml'
```

## Query Examples

### Cache Hit Rate

```yaml
sum(rate(myapp_redis_cache_hits_total[5m])) /
(
  sum(rate(myapp_redis_cache_hits_total[5m])) +
  sum(rate(myapp_redis_cache_misses_total[5m]))
) * 100
```

### P95 Latency by Command

```yaml
histogram_quantile(0.95,
  sum(rate(myapp_redis_command_duration_seconds_bucket[5m])) by (command, le)
)
```

### Requests Per Second

```yaml
sum(rate(myapp_redis_commands_total[5m])) by (command)
```

### Error Rate

```yaml
sum(rate(myapp_redis_errors_total[5m])) /
sum(rate(myapp_redis_commands_total[5m])) * 100
```

### Active Locks

```yaml
myapp_redis_locks_active
```

## Retention

Configure data retention:

```yaml
# prometheus.yml
global:
  scrape_interval: 15s

storage:
  tsdb:
    retention.time: 30d
    retention.size: 50GB
```

## Federation

Aggregate metrics from multiple Prometheus instances:

```yaml
# central-prometheus.yml
scrape_configs:
  - job_name: 'federate'
    scrape_interval: 30s
    honor_labels: true
    metrics_path: '/federate'
    params:
      'match[]':
        - '{job="nestjs-api"}'
    static_configs:
      - targets:
          - 'prom-us-east:9090'
          - 'prom-us-west:9090'
          - 'prom-eu-west:9090'
```

## Prometheus Configuration Validation

```bash
# Validate config
promtool check config prometheus.yml

# Validate rules
promtool check rules rules/*.yml

# Test query
promtool query instant http://localhost:9090 'up'
```

## Performance Tuning

### Increase Scrape Interval

```yaml
scrape_configs:
  - job_name: 'nestjs-api'
    scrape_interval: 60s  # Reduce from 15s to 60s
```

### Sample Limit

```yaml
scrape_configs:
  - job_name: 'nestjs-api'
    sample_limit: 10000  # Limit samples per scrape
```

### Target Limit

```yaml
scrape_configs:
  - job_name: 'nestjs-api'
    target_limit: 100  # Limit number of targets
```

## Troubleshooting

### Check Targets

Visit Prometheus UI: `http://localhost:9090/targets`

### Scrape Issues

```bash
# Test endpoint manually
curl http://localhost:3000/metrics

# Check Prometheus logs
docker logs prometheus

# Validate scrape config
promtool check config prometheus.yml
```

### High Cardinality

```yaml
# Find metrics with high cardinality
topk(10, count by (__name__)({__name__=~".+"}))
```

## Next Steps

- [Grafana](./grafana) — Visualize metrics
- [Alerting](./alerting) — Set up alerts
- [Troubleshooting](./troubleshooting) — Debug issues
