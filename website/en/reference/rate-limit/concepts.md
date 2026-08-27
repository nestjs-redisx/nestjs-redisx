---
title: 'Core Concepts — Rate Limit Plugin | NestJS RedisX'
description: 'Understand throttling fundamentals: rate limit keys, points, durations, refill rates, and window semantics behind NestJS Redis rate limiting.'
---

# Core Concepts

Understand rate limiting fundamentals.

## What is Rate Limiting?

Rate limiting restricts how many requests a client can make in a time period.

```mermaid
graph LR
    subgraph "Without Limit"
        C1[Client] -->|1000 req/s| S1[Server]
        S1 -->|Overloaded| S1
    end

    subgraph "With Limit"
        C2[Client] -->|1000 req/s| RL[Rate Limiter]
        RL -->|100 req/s| S2[Server]
        RL -->|429| C2
    end
```

## Key Components

### 1. Rate Limit Key

Identifies WHO is being rate limited:

```
192.168.1.1          # By IP (default extractor)
user:123             # By user ID
apikey:sk_live_xxx   # By API key
tenant:acme          # By tenant (custom extractor)
global               # Everyone combined (static key)
```

::: tip
The full Redis key is built as `{keyPrefix}{algorithm}:{key}`. With defaults: `rl:sliding-window:user:123`.
:::

### 2. Window

Time period for counting requests:

| Window | Use Case |
|--------|----------|
| 1 second | Burst protection |
| 1 minute | Standard API limits |
| 1 hour | Quota management |
| 1 day | Usage caps |

### 3. Limit (Points)

Maximum requests allowed per window:

```typescript
@RateLimit({
  points: 100,    // 100 requests
  duration: 60,   // per 60 seconds
})
```

## Rate vs Quota

| Concept | Purpose | Time Scale | Reset |
|---------|---------|------------|-------|
| **Rate Limit** | Protect server | Seconds/minutes | Rolling |
| **Quota** | Control usage | Hours/days | Fixed |

```typescript
// Rate limit: server protection
@RateLimit({ points: 100, duration: 60 })  // 100/min

// Quota: usage control (use different duration)
@RateLimit({ points: 10000, duration: 86400 })  // 10K/day
```

## Window Types

### Fixed Window

Requests counted in fixed time buckets:

```
Time:   0s      60s     120s    180s
        |-------|-------|-------|
        | 100   | 100   | 100   |
        | max   | max   | max   |
```

**Problem:** Burst at window edges

```
Time:   55s     60s     65s
        |   |   |   |   |
        +--100--+ +--100--+
           |       |
           +--200 in 10 seconds!
```

### Sliding Window

Counts requests in any rolling window:

```
Any 60-second window must have <= 100 requests

Time:   0s      30s     60s     90s
        |-------|-------|-------|
        +---------------+ <- 100 max
                +---------------+ <- 100 max
```

### Token Bucket

Tokens refill at constant rate:

```
Bucket: 100 capacity, 10 tokens/sec refill

Time 0:  [100 tokens]
         | 50 requests
Time 1:  [50 tokens]
         | +10 refill
Time 2:  [60 tokens]
         | 80 requests -> only 60 allowed
Time 3:  [0 tokens] -> must wait for refill
```

## Fail Policies

### Fail-Closed (Default)

Reject requests when Redis is unavailable:

```mermaid
graph LR
    REQ[Request] --> RL{Rate Limiter}
    RL -->|Redis OK| CHECK{Under limit?}
    CHECK -->|Yes| ALLOW[Allow]
    CHECK -->|No| REJECT[Reject]
    RL -->|Redis down| REJECT
```

**Use when:** Security is critical

### Fail-Open

Allow requests when Redis is unavailable:

```mermaid
graph LR
    REQ[Request] --> RL{Rate Limiter}
    RL -->|Redis OK| CHECK{Under limit?}
    CHECK -->|Yes| ALLOW[Allow]
    CHECK -->|No| REJECT[Reject]
    RL -->|Redis down| ALLOW
```

**Use when:** Availability is critical

## HTTP Response Codes

| Code | Meaning | When |
|------|---------|------|
| `200` | Success | Under limit |
| `429` | Too Many Requests | Limit exceeded |
| `503` | Service Unavailable | Redis down (fail-closed) |

## Rate Limit Headers

Standard headers for client awareness:

```http
X-RateLimit-Limit: 100       # Maximum requests
X-RateLimit-Remaining: 75    # Requests left
X-RateLimit-Reset: 1706123456 # Unix timestamp of reset
Retry-After: 45              # Seconds to wait (on 429)
```

## Client Handling

### Good Client Behavior

```typescript
// Check headers before hitting limit
const response = await fetch('/api/data');
const remaining = response.headers.get('X-RateLimit-Remaining');

if (parseInt(remaining) < 10) {
  console.warn('Approaching rate limit');
  // Slow down requests
}
```

### On 429 Response

```typescript
if (response.status === 429) {
  const retryAfter = response.headers.get('Retry-After');
  await sleep(parseInt(retryAfter) * 1000);
  // Retry request
}
```

## Distributed vs Per-Instance Limiting

The plugin ships two interchangeable stores. The default `redis` store keeps
one shared counter per key, so the limit is exact across all app instances:

```mermaid
graph TB
    subgraph "Application Cluster"
        A1[Instance 1]
        A2[Instance 2]
        A3[Instance 3]
    end

    subgraph "Redis"
        R[(Redis)]
    end

    A1 --> R
    A2 --> R
    A3 --> R

    Note[All instances share<br/>the same limit counters]
```

The `memory` store counts in process memory instead: zero Redis round-trip on
the request path, at the cost of an approximate global limit (each instance
enforces its own counter, so the effective limit is roughly per-node limit
multiplied by the node count). Choose per plugin default and override per
route in either direction:

```typescript
new RateLimitPlugin({ store: 'memory' }) // plugin default

@RateLimit({ store: 'redis', points: 5, duration: 300 }) // per-route override
```

Per-instance limiting is standard practice for anti-abuse (nginx `limit_req`,
Envoy's local rate limit filter work exactly this way) — but keep
auth-sensitive routes (login, OTP, password reset) and billing quotas on the
`redis` store, where exact shared counts matter. See
[Stores](./stores) for the full trade-off guide.

## Next Steps

- [Stores](./stores) — Redis vs in-memory store selection
- [Algorithms](./algorithms) — Deep dive into each algorithm
- [Configuration](./configuration) — Full configuration reference
