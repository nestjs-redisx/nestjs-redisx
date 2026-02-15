---
title: Event Streaming
description: Redis Streams vs message queues - when to use what
---

# Event Streaming

Redis Streams provide a middle ground between simple pub/sub and full message brokers. This guide helps you understand when to use them.

## What Redis Streams Provide

```mermaid
graph LR
    subgraph "Producers"
        P1[Service A]
        P2[Service B]
    end
    
    subgraph "Redis Stream"
        S[(Ordered Log)]
    end
    
    subgraph "Consumer Group"
        C1[Consumer 1]
        C2[Consumer 2]
        C3[Consumer 3]
    end
    
    P1 --> S
    P2 --> S
    S --> C1
    S --> C2
    S --> C3
```

| Feature | Redis Streams | Redis Pub/Sub |
|---------|---------------|---------------|
| Persistence | Yes | No |
| Consumer groups | Yes | No |
| Message replay | Yes | No |
| Acknowledgment | Yes | No |
| Ordering | Per-stream | Per-channel |

## When to Use Redis Streams

**Good fit:**
- Background job processing
- Event sourcing (small scale)
- Audit logs
- Real-time notifications with durability
- Task distribution across workers

**Not ideal for:**
- High-throughput event streaming (>100k msg/sec)
- Complex routing patterns
- Multi-datacenter replication
- Long-term message retention (>days)

## Comparison with Alternatives

### vs BullMQ

| Aspect | Redis Streams | BullMQ |
|--------|---------------|--------|
| Delayed jobs | Manual implementation | Built-in |
| Job priority | Manual | Built-in |
| Rate limiting | Manual | Built-in |
| Dependencies | Core Redis | Redis + BullMQ |
| Complexity | Lower | Higher |

**Use BullMQ when:** You need delays, priorities, or complex job scheduling.

**Use Streams when:** Simple queue with consumer groups is enough.

### vs Kafka

| Aspect | Redis Streams | Kafka |
|--------|---------------|-------|
| Throughput | ~100k/sec | Millions/sec |
| Retention | Limited by memory | Disk-based, unlimited |
| Partitioning | Manual (multiple streams) | Built-in |
| Operations | Simple | Complex |
| Use case | Application-level | Infrastructure-level |

**Use Kafka when:** High throughput, long retention, or complex streaming pipelines.

**Use Streams when:** Simpler needs, already using Redis.

### vs RabbitMQ

| Aspect | Redis Streams | RabbitMQ |
|--------|---------------|----------|
| Routing | Simple (stream per topic) | Complex (exchanges, bindings) |
| Protocol | Redis protocol | AMQP |
| Ordering | Guaranteed | Per-queue |
| Operations | Simple | Medium |

**Use RabbitMQ when:** Complex routing, multiple consumers per message.

**Use Streams when:** Simple fan-out or work distribution.

## Delivery Semantics

Redis Streams provide **at-least-once** delivery:

```mermaid
sequenceDiagram
    participant P as Producer
    participant S as Stream
    participant C as Consumer
    
    P->>S: XADD message
    S-->>P: Message ID
    S->>C: XREADGROUP message
    C->>C: Process message
    Note over C: Crash before ACK!
    Note over S: Message still pending
    S->>C: XREADGROUP (claim pending)
    C->>C: Process again
    C->>S: XACK message
```

::: warning At-Least-Once Semantics
Messages may be delivered multiple times. **Make consumers idempotent.**
:::

## Consumer Groups

Consumer groups enable parallel processing:

```
Stream: orders
Group: order-processors

Consumer 1: processes message 1, 4, 7...
Consumer 2: processes message 2, 5, 8...
Consumer 3: processes message 3, 6, 9...
```

Each message is delivered to **one consumer** in the group.

### Failure Handling

```mermaid
graph TB
    subgraph "Normal Flow"
        N1[Consumer reads] --> N2[Process] --> N3[ACK]
    end
    
    subgraph "Failure Flow"
        F1[Consumer reads] --> F2[Process] --> F3[Crash]
        F3 --> F4[Pending timeout]
        F4 --> F5[Claimed by another consumer]
        F5 --> F6[Reprocess]
        F6 --> F7[ACK]
    end
```

## Dead Letter Queue Pattern

After N failures, move to DLQ:

```typescript
new StreamsPlugin({
  consumer: {
    maxRetries: 3,
  },
  dlq: {
    enabled: true,
    streamSuffix: ':dlq',
  },
})
```

```mermaid
graph LR
    Main[Main Stream] -->|Success| ACK[Acknowledged]
    Main -->|Fail 1| Retry1[Retry]
    Retry1 -->|Fail 2| Retry2[Retry]
    Retry2 -->|Fail 3| DLQ[Dead Letter Queue]
```

## Memory Considerations

Streams are memory-bound. Configure limits:

```typescript
// Limit by count
await redis.xtrim('orders', 'MAXLEN', '~', 10000);

// Limit by age (Redis 7+)
await redis.xtrim('orders', 'MINID', '~', minId);
```

| Strategy | Use When |
|----------|----------|
| MAXLEN | Fixed memory budget |
| MINID | Time-based retention |
| No trimming | Audit logs (with monitoring) |

## Ordering Guarantees

| Scenario | Ordering |
|----------|----------|
| Single producer, single consumer | Guaranteed |
| Single producer, consumer group | Guaranteed per message |
| Multiple producers | Arrival order (not send order) |

For strict ordering across producers, use a single stream with sequence numbers.

## Next Steps

- [Background Jobs Recipe](../recipes/background-jobs) — Practical implementation
- [Streams Reference](../../reference/streams/) — Full API documentation
