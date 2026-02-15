---
title: Tuning
description: Configuration profiles for different workloads
---

# Tuning

Configuration profiles optimized for different workloads.

## Baseline Profiles

### Default Profile (Balanced)

For general-purpose applications:

```typescript
RedisModule.forRoot({
  clients: {
    host: process.env.REDIS_HOST,
    port: 6379,
  },
  plugins: [
    new CachePlugin({
      l1: { maxSize: 1000, ttl: 30000 },
      l2: { defaultTtl: 3600 },
    }),
    new LocksPlugin({
      defaultTtl: 30000,
      autoRenew: { enabled: true, interval: 10000 },
    }),
    new RateLimitPlugin({
      algorithm: 'sliding-window',
    }),
  ],
})
```

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| L1 size | 1000 | Moderate memory, good hit rate |
| L1 TTL | 30s | Balance freshness/efficiency |
| L2 TTL | 1 hour | Standard cache lifetime |
| Lock TTL | 30s | Typical operation duration |
| Lock renewal | 10s | Renew at 1/3 TTL |

### Latency-Sensitive Profile

For APIs where response time is critical:

```typescript
RedisModule.forRoot({
  clients: {
    host: process.env.REDIS_HOST,
    port: 6379,
    commandTimeout: 1000,  // 1s timeout
  },
  plugins: [
    new CachePlugin({
      l1: { maxSize: 5000, ttl: 60000 },  // Larger L1
      l2: { defaultTtl: 300 },             // Shorter L2
      stampede: { enabled: true },
    }),
    new LocksPlugin({
      defaultTtl: 10000,   // Shorter locks
      retry: { maxRetries: 1, initialDelay: 100 },  // Fast fail
      autoRenew: { enabled: false },
    }),
    new RateLimitPlugin({
      algorithm: 'token-bucket',  // Allows bursts
    }),
  ],
})
```

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Command timeout | 1s | Fail fast |
| L1 size | 5000 | More in-memory hits |
| L1 TTL | 60s | Longer local cache |
| Lock TTL | 10s | Short operations only |
| Lock timeout | 1s | Don't wait long |

### Throughput Profile

For batch processing and background jobs:

```typescript
RedisModule.forRoot({
  clients: {
    host: process.env.REDIS_HOST,
    port: 6379,
    enableOfflineQueue: true,
  },
  plugins: [
    new CachePlugin({
      l1: { enabled: false },  // Skip L1 for throughput
      l2: { defaultTtl: 7200 },
    }),
    new LocksPlugin({
      defaultTtl: 300000,  // 5 min for long operations
      autoRenew: { enabled: true, interval: 60000 },
    }),
    new StreamsPlugin({
      consumer: {
        batchSize: 100,       // Large batches
        blockTimeout: 10000,  // Long poll
      },
    }),
  ],
})
```

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| L1 cache | Disabled | Avoid memory pressure |
| Lock TTL | 5 min | Long batch operations |
| Batch size | 100 | Reduce round trips |
| Block timeout | 10s | Efficient long polling |

### Memory-Constrained Profile

For edge deployments or small containers:

```typescript
RedisModule.forRoot({
  clients: {
    host: process.env.REDIS_HOST,
    port: 6379,
  },
  plugins: [
    new CachePlugin({
      l1: { maxSize: 100, ttl: 10000 },  // Tiny L1
      l2: { defaultTtl: 300 },            // Short TTL
    }),
    new LocksPlugin({
      autoRenew: { enabled: false },  // Save resources
    }),
  ],
})
```

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| L1 size | 100 | Minimal memory |
| L1 TTL | 10s | Quick expiration |
| L2 TTL | 5 min | Reduce Redis memory |
| Auto-renew | Disabled | Fewer background tasks |

## Parameter Reference

### Cache Parameters

| Parameter | Range | Impact |
|-----------|-------|--------|
| `l1.maxSize` | 100-10000 | Memory usage, hit rate |
| `l1.ttl` | 5s-60s | Freshness vs hits |
| `l2.defaultTtl` | 60s-86400s | Redis memory, staleness |
| `stampede.enabled` | true/false | Protection vs complexity |

### Lock Parameters

| Parameter | Range | Impact |
|-----------|-------|--------|
| `defaultTtl` | 5s-300s | Safety vs flexibility |
| `timeout` | 0-30s | Wait time vs responsiveness |
| `autoRenew.interval` | TTL/3-TTL/2 | Reliability vs overhead |

### Stream Parameters

| Parameter | Range | Impact |
|-----------|-------|--------|
| `batchSize` | 1-1000 | Throughput vs latency |
| `blockTimeout` | 1s-30s | Responsiveness vs efficiency |
| `maxRetries` | 1-10 | Reliability vs DLQ growth |

## Tuning Process

1. **Start with Default Profile**
2. **Monitor Key Metrics**
   - Cache hit rate
   - Lock wait time
   - Operation latency
3. **Identify Bottlenecks**
   - Low hit rate → Increase TTL or L1 size
   - High lock contention → Reduce scope or TTL
   - High latency → Enable L1, reduce timeouts
4. **Adjust One Parameter at a Time**
5. **Validate with Load Testing**

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
|--------------|---------|----------|
| L1 TTL > L2 TTL | Serving stale data | L1 TTL < L2 TTL |
| Lock TTL < operation time | Lost locks | Measure operation, add margin |
| No command timeout | Hung requests | Set reasonable timeout |
| Huge batch sizes | Memory spikes | Balance batch size |

## Next Steps

- [Monitoring](../operations/monitoring) — Track tuning effectiveness
- [Connection Management](./connection-management) — Connection-level tuning
