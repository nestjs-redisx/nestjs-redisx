---
title: Troubleshooting
description: Debug common metrics issues
---

# Troubleshooting

Debug common issues with metrics collection and visualization.

## Metrics Not Appearing

### Problem: /metrics endpoint returns empty

**Symptoms:**
- Endpoint exists but no metrics shown
- Prometheus scrapes succeed but no data

**Solutions:**

**1. Check if metrics plugin is enabled:**

```typescript
// Verify plugin is registered
new MetricsPlugin({
  enabled: true,  // Make sure this is true
})
```

**2. Check if endpoint is configured:**

```typescript
new MetricsPlugin({
  exposeEndpoint: true,  // Must be true
  endpoint: '/metrics',  // Verify path
})
```

**3. Test endpoint manually:**

```bash
curl http://localhost:3000/metrics

# Should see output like:
# # HELP redisx_commands_total Total Redis commands executed
# # TYPE redisx_commands_total counter
# redisx_commands_total{command="GET",client="default",status="success"} 123
```

**4. Check application logs:**

```bash
# Look for metrics plugin initialization
# Should see: "MetricsPlugin initialized"
```

### Problem: Some metrics missing

**Causes:**

**1. Plugin metrics disabled:**

```typescript
new MetricsPlugin({
  pluginMetrics: false,  // ← This disables plugin metrics
})

// Fix: Set to true
pluginMetrics: true
```

**2. No operations performed yet:**

```typescript
// Cache metrics won't appear until cache is used
await cache.get('key');  // Now cache_hits_total appears
```

**3. Labels don't match:**

```yaml
# ❌ Wrong - label mismatch
redisx_cache_hits_total{layer="L1"}

# ✅ Correct - check actual label value
redisx_cache_hits_total{layer="l1"}
```

## High Cardinality

### Problem: Too many time series

**Symptoms:**
- Prometheus using lots of memory
- Slow query performance
- OOM errors

**Check cardinality:**

```yaml
# Find metrics with high cardinality
topk(10, count by (__name__)({__name__=~".+"}))
```

**Causes:**

**1. Using high-cardinality labels:**

```typescript
// ❌ Bad - Creates millions of series!
metrics.incrementCounter('requests_total', {
  userId: req.user.id,        // 1M users
  requestId: req.id,          // Infinite
  timestamp: Date.now().toString(),      // Infinite
});

// ✅ Good - Low cardinality
metrics.incrementCounter('requests_total', {
  endpoint: '/api/users',     // ~100 endpoints
  method: 'GET',              // 9 methods
  status: '200',              // ~50 statuses
});
```

**Solutions:**

**1. Remove high-cardinality labels:**

```typescript
// Remove user-specific labels
// Use aggregation labels instead
```

**2. Limit label values:**

```typescript
const allowedEndpoints = ['/api/users', '/api/products', '/api/orders'];

if (allowedEndpoints.includes(endpoint)) {
  metrics.incrementCounter('requests_total', { endpoint });
} else {
  metrics.incrementCounter('requests_total', { endpoint: 'other' });
}
```

**3. Increase Prometheus resources:**

```yaml
# docker-compose.yml
prometheus:
  deploy:
    resources:
      limits:
        memory: 4G
```

## Metrics Not Updating

### Problem: Gauge shows stale value

**Cause:** Gauge not being updated periodically

**Solution:**

```typescript
// ❌ Wrong - Set once, never updated
this.metrics.setGauge('queue_size', await this.getQueueSize());

// ✅ Correct - Update periodically
setInterval(async () => {
  const size = await this.getQueueSize();
  this.metrics.setGauge('queue_size', size);
}, 15000);  // Every 15 seconds
```

### Problem: Counter not incrementing

**Check:**

```typescript
// Verify counter is actually being called
console.log('Incrementing counter');
this.metrics.incrementCounter('my_counter_total');

// Check for typos in metric name — must match registered name exactly
this.metrics.incrementCounter('my_conter_total');  // ❌ Typo!
```

## Prometheus Scrape Failures

### Problem: Target down in Prometheus UI

**Check connectivity:**

```bash
# Can Prometheus reach the app?
curl http://app:3000/metrics

# Check from Prometheus container
docker exec prometheus curl http://app:3000/metrics
```

**Check scrape config:**

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'nestjs-app'
    static_configs:
      - targets: ['app:3000']  # ← Verify hostname and port
    metrics_path: '/metrics'    # ← Verify path
```

**Check logs:**

```bash
# Prometheus logs
docker logs prometheus | grep error

# Application logs
docker logs app | grep metrics
```

### Problem: Scrape timeout

**Increase timeout:**

```yaml
scrape_configs:
  - job_name: 'nestjs-app'
    scrape_timeout: 30s  # Increase from default 10s
```

**Optimize metrics endpoint:**

```typescript
// Reduce number of metrics
// Disable expensive metrics
new MetricsPlugin({
  collectDefaultMetrics: false,
})
```

## Query Performance

### Problem: Slow Prometheus queries

**Optimize queries:**

```yaml
# ❌ Slow - Calculates for all time series
rate(http_requests_total[5m])

# ✅ Faster - Filter first
rate(http_requests_total{endpoint="/api/users"}[5m])
```

**Use recording rules:**

```yaml
# Pre-calculate expensive queries
groups:
  - name: redis_rules
    interval: 15s
    rules:
      - record: redis:cache:hit_rate
        expr: |
          sum(rate(myapp_redis_cache_hits_total[5m])) /
          (sum(rate(myapp_redis_cache_hits_total[5m])) + sum(rate(myapp_redis_cache_misses_total[5m])))
```

**Then query the recording:**

```yaml
# Fast - Pre-calculated
redis:cache:hit_rate
```

## Grafana Issues

### Problem: No data in Grafana panel

**1. Check data source:**

```
Grafana → Data Sources → Prometheus
- URL: http://prometheus:9090 ✓
- Access: Proxy ✓
- Test connection: Success ✓
```

**2. Test query directly in Prometheus:**

```bash
# Visit Prometheus UI: http://localhost:9090
# Run query there first
myapp_redis_cache_hits_total
```

**3. Check time range:**

```
Panel → Query Options → Time Range
- Make sure it covers period with data
```

**4. Check query syntax:**

```yaml
# ❌ Wrong - Syntax error
redisx_cache_hits_total{layer=l1}

# ✅ Correct - Quoted value
redisx_cache_hits_total{layer="l1"}
```

### Problem: Gaps in graph

**Causes:**

**1. Scrape interval too long:**

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'app'
    scrape_interval: 60s  # Too long, reduce to 15s
```

**2. Application downtime:**

```
Graph gaps = Application was down during that time
```

**3. Missing data:**

```typescript
// Operation not happening frequently enough
// Add synthetic data or reduce scrape interval
```

## Memory Issues

### Problem: High memory usage

**Check metric count:**

```bash
# How many active time series?
curl http://localhost:9090/api/v1/status/tsdb

# Should be < 100,000 for reasonable memory usage
```

**Reduce metrics:**

```typescript
// Disable features you don't need
new MetricsPlugin({
  collectDefaultMetrics: false,  // Disable Node.js metrics
  commandMetrics: false,          // Disable per-command metrics
})
```

**Reduce histogram buckets:**

```typescript
new MetricsPlugin({
  histogramBuckets: [0.01, 0.1, 1],  // Fewer buckets
})
```

**Set retention:**

```yaml
# prometheus.yml
storage:
  tsdb:
    retention.time: 15d  # Reduce from default 15d
    retention.size: 10GB
```

## Authentication Issues

### Problem: 403 Forbidden on /metrics

**Add authentication:**

```typescript
// app.module.ts
import { NestFactory } from '@nestjs/core';
import * as basicAuth from 'express-basic-auth';

const app = await NestFactory.create(AppModule);

app.use('/metrics', basicAuth({
  users: { prometheus: process.env.METRICS_PASSWORD },
  challenge: true,
}));
```

**Configure Prometheus:**

```yaml
scrape_configs:
  - job_name: 'nestjs-app'
    basic_auth:
      username: 'prometheus'
      password: 'your-password'
```

## Debugging Checklist

- [ ] MetricsPlugin is enabled
- [ ] Endpoint is accessible (`curl /metrics`)
- [ ] Prometheus can reach application
- [ ] Scrape config is correct
- [ ] Metrics are being generated (operations happening)
- [ ] Labels match in queries
- [ ] Time range includes data
- [ ] No high cardinality issues
- [ ] Prometheus has enough resources

## Debug Commands

```bash
# Check metrics endpoint
curl http://localhost:3000/metrics

# Check Prometheus targets
curl http://localhost:9090/api/v1/targets

# Check active time series count
curl http://localhost:9090/api/v1/status/tsdb

# Check Prometheus config
curl http://localhost:9090/api/v1/status/config

# Validate Prometheus config
promtool check config prometheus.yml

# Test query
curl 'http://localhost:9090/api/v1/query?query=up'
```

## Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `HELP line already seen` | Metric defined twice | Check for duplicate metric names |
| `Target down` | Can't reach endpoint | Check network, firewall, hostname |
| `Context deadline exceeded` | Scrape timeout | Increase `scrape_timeout` |
| `OOM killed` | Too much memory | Reduce cardinality, increase memory |
| `No data points` | No operations yet | Trigger operations or wait |

## Next Steps

- [Testing](./testing) — Test metrics collection
- [Recipes](./recipes) — Real-world patterns
- [Configuration](./configuration) — Review config
- [Prometheus](./prometheus) — Check Prometheus setup
- [Grafana](./grafana) — Fix visualization issues
