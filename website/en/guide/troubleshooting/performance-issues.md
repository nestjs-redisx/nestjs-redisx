---
title: Performance Issues
description: Troubleshoot latency and throughput problems
---

# Performance Issues

Solutions for latency and throughput problems.

## Problem: High Latency

### Symptoms
- Redis operations taking >10ms
- Increased p99 latency
- Slow API responses

### Diagnosis

```bash
# Check Redis latency
redis-cli --latency

# Check slow log
redis-cli SLOWLOG GET 10

# Check network latency
redis-cli DEBUG SLEEP 0 && time redis-cli PING
```

```yaml
# Operation latency p99
histogram_quantile(0.99, rate(redisx_operation_duration_seconds_bucket[5m]))
```

### Solutions

| Cause | Solution |
|-------|----------|
| Network latency | Move Redis closer to app |
| Large values | Compress or split data |
| Expensive commands | Avoid KEYS, use SCAN |
| Connection pool exhausted | Increase pool size |
| Redis overloaded | Scale up or out |

---

## Problem: Connection Pool Exhaustion

### Symptoms
- "Cannot acquire connection" errors
- Requests timing out waiting for connection
- Spiky latency under load

### Diagnosis

```yaml
# Pool utilization
redisx_pool_active_connections / redisx_pool_max_connections

# Pending requests
redisx_pool_pending_requests
```

### Solutions

```typescript
// Increase pool size
RedisModule.forRoot({
  clients: {
    host: 'localhost',
    pool: {
      min: 10,
      max: 50,  // Increase from default
    },
  },
})
```

| Cause | Solution |
|-------|----------|
| Pool too small | Increase `pool.max` |
| Connections not released | Check for connection leaks |
| Slow commands | Optimize or add timeout |

---

## Problem: Memory Pressure

### Symptoms
- Redis memory near max
- Evictions increasing
- Slow operations

### Diagnosis

```bash
# Memory info
redis-cli INFO memory

# Find big keys
redis-cli --bigkeys

# Memory usage by key
redis-cli MEMORY USAGE "cache:big-key"
```

### Solutions

| Cause | Solution |
|-------|----------|
| TTL too long | Reduce TTL |
| Large values | Compress data |
| Too many keys | Reduce cardinality |
| No eviction policy | Set `maxmemory-policy` |

```bash
# Set eviction policy
redis-cli CONFIG SET maxmemory-policy allkeys-lru
```

---

## Problem: Slow Commands

### Symptoms
- Specific operations are slow
- SLOWLOG shows patterns
- High CPU on Redis

### Diagnosis

```bash
# Check slow commands
redis-cli SLOWLOG GET 20
```

::: warning Production Risk
`redis-cli MONITOR` impacts performance significantly. Never use in production.
:::

### Solutions

| Slow Command | Alternative |
|--------------|-------------|
| `KEYS *` | `SCAN` with cursor |
| `SMEMBERS` large set | `SSCAN` |
| `HGETALL` large hash | `HSCAN` or specific `HGET` |
| Lua with many keys | Break into smaller operations |

::: code-group
```typescript [Correct]
// Non-blocking with SCAN
const keys = [];
let cursor = '0';
do {
  const [newCursor, batch] = await redis.scan(cursor, 'MATCH', 'user:*', 'COUNT', 100);
  cursor = newCursor;
  keys.push(...batch);
} while (cursor !== '0');
```

```typescript [Wrong]
// Blocks Redis - never use in production
await redis.keys('user:*');
```
:::

---

## Problem: Throughput Bottleneck

### Symptoms
- Can't scale beyond certain RPS
- Redis CPU at 100%
- Adding app instances doesn't help

### Diagnosis

```bash
# Check Redis stats
redis-cli INFO stats

# Check CPU
redis-cli INFO cpu
```

### Solutions

| Cause | Solution |
|-------|----------|
| Single-threaded Redis | Use Redis Cluster |
| CPU-intensive commands | Optimize commands |
| Too many round trips | Use pipelining |

::: code-group
```typescript [Correct]
// Single round trip with pipeline
const pipeline = redis.pipeline();
pipeline.set('key1', 'val1');
pipeline.set('key2', 'val2');
pipeline.set('key3', 'val3');
await pipeline.exec();
```

```typescript [Wrong]
// Multiple round trips - inefficient
await redis.set('key1', 'val1');
await redis.set('key2', 'val2');
await redis.set('key3', 'val3');
```
:::

---

## Problem: Cold Start Latency

### Symptoms
- First requests after deploy are slow
- Cache miss spike after restart
- Database overwhelmed on deploy

### Solutions

```typescript
// Warm cache on startup
@Injectable()
export class CacheWarmer implements OnModuleInit {
  async onModuleInit() {
    // Pre-populate critical cache
    await this.warmPopularProducts();
    await this.warmFeatureFlags();
  }

  private async warmPopularProducts() {
    const products = await this.db.getPopularProducts(100);
    for (const product of products) {
      await this.cache.set(`product:${product.id}`, product, { ttl: 3600 });
    }
  }
}
```

## Performance Checklist

::: tip Before Going Live
Verify these items for optimal Redis performance:
:::

| Item | Status |
|------|--------|
| Connection pool sized appropriately | |
| TTLs not too long or short | |
| No `KEYS` commands in production | |
| Large values compressed | |
| Pipelining used where possible | |
| Redis topology matches workload | |
| Monitoring in place | |

## Next Steps

- [Debugging](./debugging) — Debugging tools
- [Tuning](../architecture/tuning) — Performance optimization
