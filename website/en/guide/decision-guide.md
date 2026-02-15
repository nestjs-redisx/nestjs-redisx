---
title: Decision Guide
description: Quick guide to choosing the right NestJS RedisX plugins
---

# Decision Guide

Not sure which plugin you need? This guide helps you decide in under 2 minutes.

## Quick Decision Flowchart

```mermaid
flowchart TD
    Start([What problem are you solving?]) --> Q1{Need to reduce<br>database load?}
    
    Q1 -->|Yes| Cache[Use Cache Plugin]
    Q1 -->|No| Q2{Need to prevent<br>concurrent execution?}
    
    Q2 -->|Yes| Q3{Same request<br>or any request?}
    Q3 -->|Same request retried| Idempotency[Use Idempotency Plugin]
    Q3 -->|Any concurrent request| Locks[Use Locks Plugin]
    
    Q2 -->|No| Q4{Need to limit<br>request rate?}
    
    Q4 -->|Yes| RateLimit[Use Rate Limit Plugin]
    Q4 -->|No| Q5{Need async<br>processing?}
    
    Q5 -->|Yes| Streams[Use Streams Plugin]
    Q5 -->|No| Q6{Need observability?}
    
    Q6 -->|Yes| Observability[Use Metrics + Tracing]
    Q6 -->|No| Core[Core Module Only]
```

## Decision Matrix

| Scenario | Plugin | Why |
|----------|--------|-----|
| Slow database queries | Cache | Store results, serve from memory |
| Duplicate form submissions | Idempotency | Detect and replay responses |
| Payment processing | Idempotency + Locks | Prevent double charges |
| Cron job on multiple instances | Locks | Only one instance executes |
| API abuse protection | Rate Limit | Throttle excessive requests |
| Login brute force | Rate Limit | Progressive delays |
| Background job processing | Streams | Reliable async with retries |
| Event-driven architecture | Streams | Pub/sub with persistence |
| Production monitoring | Metrics | Prometheus integration |
| Request tracing | Tracing | OpenTelemetry spans |

## Common Combinations

### E-commerce / Payments

```
Idempotency + Locks + Cache + Metrics
```

- **Idempotency**: Prevent duplicate orders/charges
- **Locks**: Serialize payment processing per order
- **Cache**: Product catalog, user sessions
- **Metrics**: Monitor transaction rates

### Public API

```
Rate Limit + Cache + Metrics + Tracing
```

- **Rate Limit**: Protect from abuse, implement tiers
- **Cache**: Reduce backend load
- **Metrics**: Track usage per client
- **Tracing**: Debug slow requests

### Event-Driven Microservices

```
Streams + Idempotency + Locks + Tracing
```

- **Streams**: Event bus between services
- **Idempotency**: Handle duplicate events
- **Locks**: Coordinate distributed operations
- **Tracing**: Follow requests across services

### Background Processing

```
Streams + Locks + Metrics
```

- **Streams**: Job queue with consumer groups
- **Locks**: Prevent duplicate cron execution
- **Metrics**: Monitor queue depth and processing time

## What RedisX Does NOT Solve

| Need | Use Instead |
|------|-------------|
| Job scheduling with delays | BullMQ |
| Complex workflows/sagas | Temporal |
| Full-text search | Elasticsearch |
| Graph queries | Neo4j |
| Time-series data | TimescaleDB |
| Message broker with routing | RabbitMQ |

## Plugin Dependencies

```mermaid
graph LR
    Core[Core Module] --> Cache
    Core --> Locks
    Core --> RateLimit[Rate Limit]
    Core --> Idempotency
    Core --> Streams
    Core --> Metrics
    Core --> Tracing
    
    Metrics -.->|enhances| Cache
    Metrics -.->|enhances| Locks
    Metrics -.->|enhances| RateLimit
    Tracing -.->|enhances| Cache
    Tracing -.->|enhances| Locks
```

All plugins depend on Core. Metrics and Tracing enhance other plugins with observability.

## Next Steps

Once you've identified your plugins:

1. [Installation](./installation) — Install required packages
2. [Quick Start](./quick-start) — Basic configuration
3. Choose your concept guide:
   - [Two-Tier Caching](./concepts/two-tier-caching)
   - [Distributed Coordination](./concepts/distributed-coordination)
   - [Rate Limiting Strategies](./concepts/rate-limiting-strategies)
   - [Event Streaming](./concepts/event-streaming)
