---
title: Grafana Dashboards
description: Visualize Redis metrics with Grafana
---

# Grafana Dashboards

Create stunning visualizations for Redis metrics.

## Setup Grafana

### Docker Compose

```yaml
# docker-compose.yml
version: '3.8'

services:
  grafana:
    image: grafana/grafana:latest
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
      - GF_USERS_ALLOW_SIGN_UP=false
    volumes:
      - grafana-data:/var/lib/grafana
      - ./grafana/provisioning:/etc/grafana/provisioning

volumes:
  grafana-data:
```

### Add Prometheus Data Source

```yaml
# grafana/provisioning/datasources/prometheus.yml
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: true
```

## Dashboard Components

### Redis Overview Panel

**Row 1: Key Metrics**

```json
{
  "title": "Cache Hit Rate",
  "targets": [{
    "expr": "sum(rate(myapp_redis_cache_hits_total[5m])) / (sum(rate(myapp_redis_cache_hits_total[5m])) + sum(rate(myapp_redis_cache_misses_total[5m]))) * 100"
  }],
  "type": "stat",
  "fieldConfig": {
    "unit": "percent",
    "thresholds": {
      "steps": [
        { "value": 0, "color": "red" },
        { "value": 70, "color": "yellow" },
        { "value": 90, "color": "green" }
      ]
    }
  }
}
```

### Command Latency Graph

```json
{
  "title": "P95 Command Latency",
  "targets": [{
    "expr": "histogram_quantile(0.95, sum(rate(myapp_redis_command_duration_seconds_bucket[5m])) by (command, le))",
    "legendFormat": "{{command}}"
  }],
  "type": "graph",
  "yaxes": [{
    "format": "s",
    "label": "Latency"
  }]
}
```

### Operations Per Second

```json
{
  "title": "Operations/sec",
  "targets": [{
    "expr": "sum(rate(myapp_redis_commands_total[5m])) by (command)",
    "legendFormat": "{{command}}"
  }],
  "type": "graph",
  "stack": true
}
```

## Complete Dashboard JSON

### Redis Performance Dashboard

```json
{
  "dashboard": {
    "title": "Redis Performance",
    "tags": ["redis", "performance"],
    "timezone": "browser",
    "panels": [
      {
        "id": 1,
        "title": "Cache Hit Rate",
        "type": "stat",
        "gridPos": { "x": 0, "y": 0, "w": 6, "h": 4 },
        "targets": [{
          "expr": "sum(rate(myapp_redis_cache_hits_total[5m])) / (sum(rate(myapp_redis_cache_hits_total[5m])) + sum(rate(myapp_redis_cache_misses_total[5m]))) * 100",
          "refId": "A"
        }],
        "fieldConfig": {
          "defaults": {
            "unit": "percent",
            "thresholds": {
              "mode": "absolute",
              "steps": [
                { "value": 0, "color": "red" },
                { "value": 70, "color": "yellow" },
                { "value": 90, "color": "green" }
              ]
            }
          }
        }
      },
      {
        "id": 2,
        "title": "P95 Latency",
        "type": "stat",
        "gridPos": { "x": 6, "y": 0, "w": 6, "h": 4 },
        "targets": [{
          "expr": "histogram_quantile(0.95, sum(rate(myapp_redis_command_duration_seconds_bucket[5m])) by (le))",
          "refId": "A"
        }],
        "fieldConfig": {
          "defaults": {
            "unit": "s",
            "thresholds": {
              "steps": [
                { "value": 0, "color": "green" },
                { "value": 0.01, "color": "yellow" },
                { "value": 0.05, "color": "red" }
              ]
            }
          }
        }
      },
      {
        "id": 3,
        "title": "Operations/sec",
        "type": "stat",
        "gridPos": { "x": 12, "y": 0, "w": 6, "h": 4 },
        "targets": [{
          "expr": "sum(rate(myapp_redis_commands_total[5m]))",
          "refId": "A"
        }],
        "fieldConfig": {
          "defaults": {
            "unit": "ops"
          }
        }
      },
      {
        "id": 4,
        "title": "Error Rate",
        "type": "stat",
        "gridPos": { "x": 18, "y": 0, "w": 6, "h": 4 },
        "targets": [{
          "expr": "sum(rate(myapp_redis_errors_total[5m])) / sum(rate(myapp_redis_commands_total[5m])) * 100",
          "refId": "A"
        }],
        "fieldConfig": {
          "defaults": {
            "unit": "percent",
            "thresholds": {
              "steps": [
                { "value": 0, "color": "green" },
                { "value": 0.1, "color": "yellow" },
                { "value": 1, "color": "red" }
              ]
            }
          }
        }
      },
      {
        "id": 5,
        "title": "Command Latency Distribution",
        "type": "graph",
        "gridPos": { "x": 0, "y": 4, "w": 12, "h": 8 },
        "targets": [
          {
            "expr": "histogram_quantile(0.50, sum(rate(myapp_redis_command_duration_seconds_bucket[5m])) by (command, le))",
            "legendFormat": "{{command}} p50",
            "refId": "A"
          },
          {
            "expr": "histogram_quantile(0.95, sum(rate(myapp_redis_command_duration_seconds_bucket[5m])) by (command, le))",
            "legendFormat": "{{command}} p95",
            "refId": "B"
          },
          {
            "expr": "histogram_quantile(0.99, sum(rate(myapp_redis_command_duration_seconds_bucket[5m])) by (command, le))",
            "legendFormat": "{{command}} p99",
            "refId": "C"
          }
        ],
        "yaxes": [{
          "format": "s",
          "label": "Latency"
        }]
      },
      {
        "id": 6,
        "title": "Operations by Command",
        "type": "graph",
        "gridPos": { "x": 12, "y": 4, "w": 12, "h": 8 },
        "targets": [{
          "expr": "sum(rate(myapp_redis_commands_total[5m])) by (command)",
          "legendFormat": "{{command}}",
          "refId": "A"
        }],
        "stack": true,
        "yaxes": [{
          "format": "ops",
          "label": "Ops/sec"
        }]
      }
    ],
    "refresh": "30s",
    "time": {
      "from": "now-1h",
      "to": "now"
    }
  }
}
```

## Key Panels

### 1. Cache Metrics

**Cache Hit Rate:**

```yaml
sum(rate(myapp_redis_cache_hits_total[5m])) /
(sum(rate(myapp_redis_cache_hits_total[5m])) + sum(rate(myapp_redis_cache_misses_total[5m]))) * 100
```

**Cache Size (L1 + L2):**

```yaml
sum(myapp_redis_cache_size) by (layer)
```

**Stampede Preventions:**

```yaml
rate(myapp_redis_cache_stampede_prevented_total[5m])
```

### 2. Lock Metrics

**Active Locks:**

```yaml
myapp_redis_locks_active
```

**Lock Acquisition Rate:**

```yaml
sum(rate(myapp_redis_lock_acquisitions_total[5m]))
```

**Lock Wait Time:**

```yaml
histogram_quantile(0.95, sum(rate(myapp_redis_lock_wait_duration_seconds_bucket[5m])) by (le))
```

### 3. Rate Limit Metrics

**Requests by Status:**

```yaml
sum(rate(myapp_redis_ratelimit_requests_total[5m])) by (status)
```

**Block Rate:**

```yaml
sum(rate(myapp_redis_ratelimit_requests_total{status="rejected"}[5m])) /
sum(rate(myapp_redis_ratelimit_requests_total[5m])) * 100
```

## Variables

Add dashboard variables for filtering:

```json
{
  "templating": {
    "list": [
      {
        "name": "layer",
        "type": "query",
        "query": "label_values(myapp_redis_cache_hits_total, layer)",
        "multi": true,
        "includeAll": true
      },
      {
        "name": "command",
        "type": "query",
        "query": "label_values(myapp_redis_commands_total, command)",
        "multi": true,
        "includeAll": true
      },
      {
        "name": "interval",
        "type": "interval",
        "query": "1m,5m,10m,30m,1h",
        "current": {
          "value": "5m"
        }
      }
    ]
  }
}
```

Use variables in queries:

```yaml
sum(rate(myapp_redis_cache_hits_total{layer=~"$layer"}[$interval]))
```

## Annotations

Mark events on graphs:

```json
{
  "annotations": {
    "list": [
      {
        "name": "Deployments",
        "datasource": "Prometheus",
        "expr": "changes(myapp_build_info[5m]) > 0",
        "titleFormat": "Deployment",
        "textFormat": "Version: {{version}}"
      }
    ]
  }
}
```

## Alerts in Grafana

### High Error Rate Alert

```json
{
  "alert": {
    "name": "High Redis Error Rate",
    "conditions": [{
      "evaluator": {
        "params": [1],
        "type": "gt"
      },
      "operator": {
        "type": "and"
      },
      "query": {
        "params": ["A", "5m", "now"]
      },
      "reducer": {
        "type": "avg"
      },
      "type": "query"
    }],
    "executionErrorState": "alerting",
    "frequency": "1m",
    "handler": 1,
    "message": "Redis error rate is above 1%",
    "name": "High Redis Error Rate",
    "noDataState": "no_data",
    "notifications": []
  },
  "targets": [{
    "expr": "sum(rate(myapp_redis_errors_total[5m])) / sum(rate(myapp_redis_commands_total[5m])) * 100",
    "refId": "A"
  }]
}
```

### Low Cache Hit Rate Alert

```json
{
  "alert": {
    "name": "Low Cache Hit Rate",
    "conditions": [{
      "evaluator": {
        "params": [70],
        "type": "lt"
      },
      "query": {
        "params": ["A", "5m", "now"]
      },
      "reducer": {
        "type": "avg"
      },
      "type": "query"
    }],
    "frequency": "1m",
    "message": "Cache hit rate is below 70%"
  },
  "targets": [{
    "expr": "sum(rate(myapp_redis_cache_hits_total[5m])) / (sum(rate(myapp_redis_cache_hits_total[5m])) + sum(rate(myapp_redis_cache_misses_total[5m]))) * 100",
    "refId": "A"
  }]
}
```

## Dashboard Organization

### Folder Structure

```
Dashboards
├── Redis
│   ├── Overview
│   ├── Performance
│   ├── Cache
│   ├── Locks
│   └── Rate Limiting
└── Application
    ├── API
    └── Background Jobs
```

### Row Organization

```
Overview Dashboard
├── Row: Key Metrics (Cache Hit Rate, P95 Latency, Ops/sec, Errors)
├── Row: Command Performance (Latency graphs)
├── Row: Cache (Hit/Miss rates, Size, Stampede prevention)
├── Row: Locks (Active, Acquisition rate, Wait time)
└── Row: Rate Limiting (Allowed, Blocked, Block rate)
```

## Export/Import

### Export Dashboard

```bash
# Export via API
curl -H "Authorization: Bearer $API_KEY" \
  http://localhost:3001/api/dashboards/uid/redis-overview | \
  jq '.dashboard' > redis-overview.json
```

### Import Dashboard

```bash
# Import via API
curl -X POST -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d @redis-overview.json \
  http://localhost:3001/api/dashboards/db
```

### Provisioning

```yaml
# grafana/provisioning/dashboards/redis.yml
apiVersion: 1

providers:
  - name: 'Redis Dashboards'
    orgId: 1
    folder: 'Redis'
    type: file
    options:
      path: /etc/grafana/dashboards/redis
```

## Best Practices

**1. Use template variables for filtering**

**2. Set appropriate time ranges (last 1h, 6h, 24h)**

**3. Add threshold colors (green/yellow/red)**

**4. Include both rate and absolute values**

**5. Group related panels in rows**

**6. Add panel descriptions**

**7. Use consistent units (seconds, ops, percent)**

**8. Set auto-refresh (30s, 1m)**

## Next Steps

- [Alerting](./alerting) — Set up alerts
- [Custom Metrics](./custom-metrics) — Add custom panels
- [Troubleshooting](./troubleshooting) — Debug dashboard issues
