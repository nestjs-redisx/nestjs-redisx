---
title: Anti-Stampede Protection
description: Prevent cache stampede and thundering herd problems
---

# Anti-Stampede Protection

Prevent multiple processes from hammering your database when cache expires.

## The Problem

When a popular cache entry expires, many requests arrive simultaneously — potentially overloading the database.

**Real impact:**
- 100 concurrent requests × 50ms query = 5 seconds of DB saturation
- Database connection pool exhausted
- Cascading failures

## The Solution

Only ONE request fetches from database, others wait for its result.

## How It Works

Stampede protection uses a **two-layer architecture**:

```
Layer 1: Local Singleflight (in-memory)
  ├─ Coalesces concurrent requests within the SAME process
  ├─ Uses Promise coalescing — waiters share the same Promise
  └─ No Redis calls, zero latency overhead

Layer 2: Distributed Redis Lock (cross-process)
  ├─ Acquires lock via SET NX EX (atomic set-if-not-exists with TTL)
  ├─ Lock key format: _stampede:{cacheKey}
  ├─ Lock released via Lua script (only owner can release)
  └─ Prevents multiple instances from loading simultaneously
```

**Step by step:**

1. Request arrives, cache miss detected in `getOrSet()` (via Service API or `@Cached` decorator)
2. Check local flights — if another request is already loading this key, **wait for its Promise**
3. Register new flight (synchronous, before any async work)
4. Try to acquire distributed Redis lock (`SET _stampede:{key} {value} EX {ttl} NX`)
5. Execute loader function with timeout
6. Resolve all local waiters with the loaded value
7. Release Redis lock (Lua script ensures only owner releases)
8. Cache the result

Waiting uses `Promise.race()` — no polling, no busy-waiting.

::: tip @Cached includes stampede protection
Since v1.1.0, `@Cached` decorator uses `getOrSet()` internally — stampede protection is automatic for both decorator and Service API usage.
:::

## Configuration

```typescript
new CachePlugin({
  stampede: {
    enabled: true,        // Enable protection (default: true)
    lockTimeout: 5000,    // Loader execution timeout in ms (default: 5000)
    waitTimeout: 10000,   // Max time waiters wait for result in ms (default: 10000)
    fallback: 'load',     // Behavior when lock fails: 'load' | 'error' | 'null' (default: 'load')
  },
})
```

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `true` | Enable stampede protection globally |
| `lockTimeout` | `5000` | Max time for loader execution (ms). Also used as Redis lock TTL. |
| `waitTimeout` | `10000` | Max time a waiter will wait for the leader's result (ms). |
| `fallback` | `'load'` | Behavior when Redis lock cannot be acquired: `'load'` (execute loader anyway), `'error'` (throw), `'null'` (return null). |

## Service API Usage

Stampede protection is automatic when using `getOrSet`:

```typescript
// With getOrSet — stampede protected by default
const data = await this.cache.getOrSet(
  'popular-key',
  () => this.db.fetchData(),
  { ttl: 300 }
);

// Disable for specific call
const data = await this.cache.getOrSet(
  'user-key',
  () => this.db.fetchUser(id),
  { ttl: 300, skipStampede: true }
);
```

## Statistics

```typescript
const stats = await this.cache.getStats();

/*
{
  stampedePrevented: 142,  // Total stampede events prevented
}
*/
```

The stampede protection service also tracks internal stats:

| Metric | Description |
|--------|-------------|
| `activeFlights` | Currently in-flight loader executions |
| `totalWaiters` | Sum of all waiters across active flights |
| `oldestFlight` | Duration of the oldest in-flight request (ms) |
| `prevented` | Total stampede events prevented |

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Loader throws | Error propagates to caller. Waiters also receive the error. Cache is not updated. |
| Loader exceeds `lockTimeout` | Throws `StampedeError`. Redis lock expires automatically. |
| Waiter exceeds `waitTimeout` | Throws `StampedeError`. Does not affect the leader. |
| Redis lock acquisition fails | Loader executes anyway (fallback). Protection still works at process level via singleflight. |
| Redis unavailable | Local singleflight still protects within the same process. |

## Debugging

Lock keys in Redis use the format `_stampede:{cacheKey}`. To inspect active locks:

```bash
# In redis-cli
KEYS _stampede:*
```

If a lock is stuck (rare — TTL should auto-expire):

```bash
# Check TTL
TTL _stampede:popular-key

# Force remove (use with caution)
DEL _stampede:popular-key
```

## Comparison

| Scenario | Without Protection | With Protection |
|----------|-------------------|-----------------|
| 100 concurrent requests | 100 DB queries | 1 DB query |
| Database load | Spike | Stable |
| Response time (leader) | 50ms | 50ms |
| Response time (waiters) | 50ms each | ~60ms (shared wait) |

## Next Steps

- [Stale-While-Revalidate](./swr) — Serve stale data while refreshing
- [Monitoring](./monitoring) — Track cache performance
