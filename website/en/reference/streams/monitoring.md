---
title: Monitoring
description: Metrics, logging, and debugging streams
---

# Monitoring

Monitor stream health and performance.

## Key Metrics

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| **Stream Length** | Total messages in stream | > 1,000,000 |
| **Consumer Lag** | Messages waiting to be processed | > 10,000 |
| **Pending Messages** | Messages delivered but not ACKed | > 1,000 |
| **Processing Rate** | Messages processed per second | < expected rate |
| **Error Rate** | Failed messages per second | > 1% |
| **DLQ Size** | Messages in dead letter queue | > 100 |

## Prometheus Metrics

### Setup

<<< @/apps/demo/src/plugins/streams/monitoring-metrics.usage.ts{typescript}

### Collect Metrics

<<< @/apps/demo/src/plugins/streams/monitoring-collector.usage.ts{typescript}

### Instrument Consumers

<<< @/apps/demo/src/plugins/streams/monitoring-instrumented.usage.ts{typescript}

## Grafana Dashboard

### Built-in Metrics (redisx_*)

These metrics are automatically collected by the Metrics plugin — no extra code needed:

**Processing Rate (success):**

```yaml
rate(redisx_stream_messages_consumed_total{stream="orders",status="success"}[5m])
```

**Error Rate:**

```yaml
rate(redisx_stream_messages_consumed_total{stream="orders",status="error"}[5m])
```

**Retry Rate:**

```yaml
rate(redisx_stream_messages_consumed_total{stream="orders",status="retry"}[5m])
```

**DLQ Rate:**

```yaml
rate(redisx_stream_messages_consumed_total{stream="orders",status="dead_letter"}[5m])
```

**P95 Processing Duration:**

```yaml
histogram_quantile(0.95,
  rate(redisx_stream_processing_duration_seconds_bucket[5m])
)
```

**Publish Rate:**

```yaml
rate(redisx_stream_messages_published_total{stream="orders"}[5m])
```

### Custom Metrics

The examples above (in "Collect Metrics" and "Instrument Consumers") show how to add your own application-level metrics for stream length, consumer lag, pending counts, and DLQ size. These are not built-in — you implement them using the `IStreamProducer.getStreamInfo()` and `IStreamConsumer.getPending()` APIs with your own Prometheus registry.

**Stream Length (custom):**

```yaml
stream_length{stream="orders"}
```

**Consumer Lag (custom):**

```yaml
stream_consumer_lag{stream="orders",group="processors"}
```

**DLQ Size (custom):**

```yaml
increase(stream_dlq_size{stream="orders"}[1h])
```

### Alert Rules (built-in)

Using built-in `redisx_*` metrics:

**High Error Rate:**

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
    description: "{{ $value | humanizePercentage }} errors on {{ $labels.stream }}"
```

**High DLQ Rate:**

```yaml
- alert: HighDLQRate
  expr: rate(redisx_stream_messages_consumed_total{status="dead_letter"}[5m]) > 0
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "Messages entering DLQ on {{ $labels.stream }}"
```

### Alert Rules (custom)

Using custom metrics from your collector (see examples above):

**High Consumer Lag:**

```yaml
- alert: HighConsumerLag
  expr: stream_consumer_lag > 10000
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "High consumer lag on {{ $labels.stream }}"
    description: "{{ $value }} messages waiting to be processed"
```

**High Pending Messages:**

```yaml
- alert: HighPendingMessages
  expr: stream_pending_messages > 1000
  for: 10m
  labels:
    severity: warning
  annotations:
    summary: "High pending messages on {{ $labels.stream }}/{{ $labels.group }}"
```

**DLQ Growing:**

```yaml
- alert: DLQGrowing
  expr: increase(stream_dlq_size[1h]) > 10
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "DLQ size growing on {{ $labels.stream }}"
```

## Redis CLI Monitoring

### Stream Info

```bash
# Get stream info
redis-cli XINFO STREAM orders

# Output:
# 1) length
# 2) (integer) 12345
# 3) radix-tree-keys
# 4) (integer) 1
# 5) radix-tree-nodes
# 6) (integer) 2
# 7) groups
# 8) (integer) 3
# 9) first-entry
# 10) 1) "1706123456789-0"
#     2) 1) "field1" 2) "value1"
```

### Consumer Group Info

```bash
# List groups
redis-cli XINFO GROUPS orders

# Output per group:
# 1) name
# 2) "processors"
# 3) consumers
# 4) (integer) 3
# 5) pending
# 6) (integer) 150
# 7) last-delivered-id
# 8) "1706123456799-0"
```

### Pending Messages

```bash
# Get pending count
redis-cli XPENDING orders processors

# Output:
# 1) (integer) 150        # Total pending
# 2) "1706123456789-0"    # Oldest ID
# 3) "1706123456799-0"    # Newest ID
# 4) 1) 1) "worker-1"     # Consumer
#       2) "100"          # Pending count
#    2) 1) "worker-2"
#       2) "50"
```

### Consumer Info

```bash
# List consumers
redis-cli XINFO CONSUMERS orders processors

# Output per consumer:
# 1) name
# 2) "worker-1"
# 3) pending
# 4) (integer) 100
# 5) idle
# 6) (integer) 5432  # ms since last activity
```

## Application Logging

### Structured Logging

<<< @/apps/demo/src/plugins/streams/monitoring-logging.usage.ts{typescript}

## Health Checks

<<< @/apps/demo/src/plugins/streams/monitoring-health.usage.ts{typescript}

## Debug Tools

### Inspect Messages

<<< @/apps/demo/src/plugins/streams/monitoring-debugger.usage.ts{typescript}

### Real-time Monitor

```typescript
@Injectable()
export class RealtimeMonitor {
  @Cron('*/10 * * * * *')  // Every 10 seconds
  async printStats() {
    const streams = ['orders', 'notifications'];

    // IStreamConsumer has no getGroups() — track known group names
    const groupNames = ['processors', 'notifications'];

    for (const stream of streams) {
      const info = await this.producer.getStreamInfo(stream);

      console.log(`\n=== ${stream} ===`);
      console.log(`Length: ${info.length}`);
      console.log(`Groups: ${info.groups}`);

      for (const groupName of groupNames) {
        const pending = await this.consumer.getPending(stream, groupName);
        console.log(`  ${groupName}:`);
        console.log(`    Pending: ${pending.count}`);
        console.log(`    Consumers: ${pending.consumers.length}`);
      }
    }
  }
}
```

## Best Practices

**1. Monitor consumer lag continuously:**

```typescript
@Cron('*/1 * * * *')  // Every minute
async checkLag() {
  const lag = await this.getConsumerLag('orders', 'processors');
  if (lag > threshold) {
    await this.alertService.send('High consumer lag');
  }
}
```

**2. Set up alerts for DLQ growth:**

```typescript
@Cron('*/5 * * * *')
async checkDLQ() {
  const size = await this.getDLQSize('orders');
  if (size > 100) {
    await this.alertService.send('DLQ size critical');
  }
}
```

**3. Track processing duration:**

```typescript
const timer = this.metrics.processingDuration.startTimer();
try {
  await this.process(message);
} finally {
  timer();
}
```

**4. Log errors with context:**

```typescript
catch (error) {
  this.logger.error({
    message: 'Processing failed',
    messageId: message.id,
    stream: message.stream,
    attempt: message.attempt,
    error: error.message,
    data: message.data,
  });
}
```

## Next Steps

- [Testing](./testing) — Test stream consumers
- [Troubleshooting](./troubleshooting) — Debug common issues
