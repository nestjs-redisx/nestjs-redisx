---
title: Monitoring
description: Metrics, logging, and debugging idempotency
---

# Monitoring

Track idempotency operations and debug issues.

## Available Metrics

When using `MetricsPlugin` alongside `IdempotencyPlugin`, the following metrics are emitted:

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `redisx_idempotency_requests_total` | Counter | `status=new` | First-time requests |
| `redisx_idempotency_requests_total` | Counter | `status=replay` | Duplicate/cached responses |
| `redisx_idempotency_requests_total` | Counter | `status=mismatch` | Fingerprint mismatches |
| `redisx_idempotency_duration_seconds` | Histogram | — | Processing duration |

## Prometheus Integration

Metrics are automatically emitted when `MetricsPlugin` is registered alongside `IdempotencyPlugin`:

<<< @/apps/demo/src/plugins/idempotency/monitoring-metrics.setup.ts{typescript}

### Metrics Endpoint

```bash
curl http://localhost:3000/metrics

# Output:
# redisx_idempotency_requests_total{status="new"} 150
# redisx_idempotency_requests_total{status="replay"} 45
# redisx_idempotency_requests_total{status="mismatch"} 2
# redisx_idempotency_duration_seconds_bucket{le="0.1"} 120
# redisx_idempotency_duration_seconds_bucket{le="0.5"} 145
```

## Grafana Dashboard

### Query Examples

**New vs Replay Requests:**

```yaml
sum(rate(redisx_idempotency_requests_total{status="new"}[5m]))
sum(rate(redisx_idempotency_requests_total{status="replay"}[5m]))
```

**Replay Request Rate:**

```yaml
(
  sum(rate(redisx_idempotency_requests_total{status="replay"}[5m]))
  /
  sum(rate(redisx_idempotency_requests_total[5m]))
) * 100
```

**P95 Processing Duration:**

```yaml
histogram_quantile(0.95,
  rate(redisx_idempotency_duration_seconds_bucket[5m])
)
```

**Fingerprint Mismatch Rate:**

```yaml
rate(redisx_idempotency_requests_total{status="mismatch"}[5m])
```

### Alert Rules

**High Fingerprint Mismatch Rate:**

```yaml
- alert: HighFingerprintMismatchRate
  expr: |
    rate(redisx_idempotency_requests_total{status="mismatch"}[5m]) > 5
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "High idempotency fingerprint mismatch rate"
    description: "{{ $value }} mismatches per second"
```

**Low New Request Success Rate:**

```yaml
- alert: IdempotencyHighReplayRate
  expr: |
    (
      sum(rate(redisx_idempotency_requests_total{status="replay"}[5m]))
      /
      sum(rate(redisx_idempotency_requests_total[5m]))
    ) > 0.5
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Over 50% of idempotent requests are replays"
```

## Logging

### Enable Debug Logging

Use NestJS logger to see idempotency debug output. Set the log level to `debug` in your application:

```typescript
const app = await NestFactory.create(AppModule, {
  logger: ['debug', 'log', 'warn', 'error'],
});
```

### Log Output

```
[IdempotencyInterceptor] New request: key=payment-123, fingerprint=abc123
[IdempotencyInterceptor] Duplicate request: key=payment-123
[IdempotencyInterceptor] Fingerprint mismatch: key=payment-123
[IdempotencyInterceptor] Concurrent request: key=payment-123, waiting=true
[IdempotencyInterceptor] Timeout: key=payment-123
```

### Structured Logging

<<< @/apps/demo/src/plugins/idempotency/monitoring-logging.usage.ts{typescript}

## Redis Inspection

### List All Keys

```bash
redis-cli --scan --pattern 'idempotency:*'

# Output:
# idempotency:payment-123
# idempotency:order-456
# idempotency:transfer-789
```

### Inspect Specific Key

Idempotency records are stored as Redis hashes:

```bash
redis-cli HGETALL idempotency:payment-123

# Output:
# 1) "fingerprint"
# 2) "abc123..."
# 3) "status"
# 4) "completed"
# 5) "statusCode"
# 6) "201"
# 7) "response"
# 8) "{\"id\":456}"
# 9) "startedAt"
# 10) "1706123456000"
# 11) "completedAt"
# 12) "1706123457000"
```

### Check TTL

```bash
redis-cli TTL idempotency:payment-123

# Output:
# 86342  (seconds remaining)
```

### Count Records by Status

```bash
redis-cli --eval count-by-status.lua , idempotency:

# Lua script:
local keys = redis.call('KEYS', ARGV[1] .. '*')
local counts = {processing=0, completed=0, failed=0}

for _, key in ipairs(keys) do
  local status = redis.call('HGET', key, 'status')
  if status then
    counts[status] = (counts[status] or 0) + 1
  end
end

return cjson.encode(counts)
```

## Custom Monitoring

### Event Emitter

<<< @/apps/demo/src/plugins/idempotency/monitoring-events.usage.ts{typescript}

## Debugging

### Debug Mode

Enable NestJS debug logging to see internal idempotency operations:

```typescript
const app = await NestFactory.create(AppModule, {
  logger: ['debug', 'log', 'warn', 'error'],
});
```

Example output:

```
[IdempotencyService] Check: key=payment-123
[IdempotencyService] Fingerprint generated: abc123
[IdempotencyService] Redis lookup: found=true, status=processing
[IdempotencyService] Waiting for completion: key=payment-123
[IdempotencyService] Response cached: key=payment-123, ttl=86400s
```

### Trace Requests

```typescript
import { Span } from '@opentelemetry/api';

@Injectable()
export class IdempotencyTracer {
  async checkIdempotency(key: string, span: Span): Promise<void> {
    span.setAttribute('idempotency.key', key);

    const record = await this.get(key);

    span.setAttribute('idempotency.status', record?.status || 'new');
    span.setAttribute('idempotency.cached', !!record);

    if (record) {
      const age = Date.now() - record.completedAt;
      span.setAttribute('idempotency.cache_age_ms', age);
    }
  }
}
```

## Health Checks

<<< @/apps/demo/src/plugins/idempotency/monitoring-health.usage.ts{typescript}

## Dashboard Example

### Admin Endpoint

<<< @/apps/demo/src/plugins/idempotency/monitoring-admin.usage.ts{typescript}

## Next Steps

- [Testing](./testing) — Test idempotent endpoints
- [Troubleshooting](./troubleshooting) — Debug issues
