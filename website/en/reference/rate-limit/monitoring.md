---
title: Monitoring
description: Metrics, logging, and observability for rate limiting
---

# Monitoring

Track rate limit performance and usage.

## Available Metrics

When the `MetricsPlugin` is registered alongside `RateLimitPlugin`, the following Prometheus metrics are emitted automatically:

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `redisx_ratelimit_requests_total` | Counter | `status` (`allowed` \| `rejected`) | Rate limit check results |

## Prometheus Integration

Metrics are emitted automatically when `MetricsPlugin` is registered alongside `RateLimitPlugin`:

<<< @/apps/demo/src/plugins/rate-limit/monitoring-metrics.setup.ts{typescript}

### Prometheus Queries

```yaml
# Rejection rate
rate(redisx_ratelimit_requests_total{status="rejected"}[5m])

# Success rate
rate(redisx_ratelimit_requests_total{status="allowed"}[5m])
/ rate(redisx_ratelimit_requests_total[5m])
```

## Grafana Dashboard

### Query Examples

**Rejection Rate:**

```yaml
rate(redisx_ratelimit_requests_total{status="rejected"}[5m])
```

**Success Rate:**

```yaml
rate(redisx_ratelimit_requests_total{status="allowed"}[5m])
/ rate(redisx_ratelimit_requests_total[5m])
```

**Alert Condition — High Rejection Rate (>10%):**

```yaml
(
  sum(rate(redisx_ratelimit_requests_total{status="rejected"}[5m]))
  /
  sum(rate(redisx_ratelimit_requests_total[5m]))
) > 0.1
```

## Custom Logging

Rate limit lifecycle events are tracked automatically via `MetricsPlugin` and `TracingPlugin`.
For custom logging, wrap the `RateLimitService`:

<<< @/apps/demo/src/plugins/rate-limit/monitoring-logging.usage.ts{typescript}

### Log Aggregation

**Structured Logging:**

```typescript
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';

@Module({
  imports: [
    WinstonModule.forRoot({
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json(),
          ),
        }),
      ],
    }),
  ],
})
export class AppModule {}
```

**Log Example:**

```json
{
  "timestamp": "2025-01-28T12:00:00.000Z",
  "level": "warn",
  "message": "Rate limit exceeded",
  "context": "RateLimit",
  "key": "user:123",
  "endpoint": "/api/data",
  "retryAfter": 45
}
```

## Alerting

### Alert Rules

**High Rejection Rate:**

```yaml
- alert: HighRateLimitRejections
  expr: |
    (
      sum(rate(redisx_ratelimit_requests_total{status="rejected"}[5m]))
      /
      sum(rate(redisx_ratelimit_requests_total[5m]))
    ) > 0.1
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "High rate limit rejection rate"
    description: "{{ $value | humanizePercentage }} of requests are being rate limited"
```

## Custom Monitoring

### Event Emitter

```typescript
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class RateLimitMonitor {
  constructor(private eventEmitter: EventEmitter2) {}

  onRateLimitCheck(key: string, result: RateLimitResult): void {
    this.eventEmitter.emit('rate-limit.check', { key, result });
  }

  onRateLimitExceeded(key: string, result: RateLimitResult): void {
    this.eventEmitter.emit('rate-limit.exceeded', { key, result });
  }
}

// Listen to events
@Injectable()
export class RateLimitListener {
  @OnEvent('rate-limit.exceeded')
  handleExceeded(payload: { key: string; result: RateLimitResult }): void {
    console.log(`Rate limit exceeded for ${payload.key}`);
    // Send to monitoring service, Slack, etc.
  }
}
```

## Health Checks

<<< @/apps/demo/src/plugins/rate-limit/monitoring-health.usage.ts{typescript}

## Dashboard Example

Create a monitoring endpoint:

```typescript
@Controller('admin')
export class AdminController {
  constructor(
    @Inject(RATE_LIMIT_SERVICE)
    private rateLimitService: IRateLimitService,
  ) {}

  @Get('rate-limits')
  async getRateLimitStats() {
    return {
      topUsers: await this.getTopRateLimitedUsers(),
      rejectionRate: await this.getRejectionRate(),
      activeKeys: await this.getActiveKeys(),
    };
  }

  private async getTopRateLimitedUsers() {
    // Query metrics or Redis for top rate-limited keys
    // Return list of users hitting limits most often
  }
}
```

## Real-Time Monitoring

### WebSocket Updates

```typescript
@WebSocketGateway()
export class RateLimitGateway {
  @WebSocketServer()
  server: Server;

  onRateLimitExceeded(key: string, result: RateLimitResult): void {
    this.server.emit('rate-limit-exceeded', {
      key,
      retryAfter: result.retryAfter,
      timestamp: new Date(),
    });
  }
}
```

## Next Steps

- [Testing](./testing) — Test rate limits
- [Troubleshooting](./troubleshooting) — Debug issues
