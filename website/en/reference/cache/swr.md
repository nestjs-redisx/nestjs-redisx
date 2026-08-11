---
title: 'Stale-While-Revalidate Guide — Cache Plugin | NestJS RedisX'
description: 'Guide to SWR in @nestjs-redisx/cache: staleTime windows, cachedAt and expiresAt metadata, background revalidation, and choosing when to serve stale data.'
---

# Stale-While-Revalidate (SWR)

Return cached data immediately, refresh in background.

::: tip Works without Redis
SWR needs only local storage, so it also works in [`mode: 'l1-only'`](./configuration#running-without-redis-l1-only) (no Redis) — single-instance.
:::

## When to Use

| Use Case | SWR? | Reason |
|----------|------|--------|
| User profile | Yes | Stale OK for seconds |
| Product catalog | Yes | Changes rarely |
| Dashboard stats | Yes | Approximate OK |
| Shopping cart | No | Must be current |
| Inventory count | No | Must be accurate |
| Auth tokens | No | Security critical |

## How It Works

SWR extends the cache lifetime with a **stale window**. During this window, cached data is returned immediately while a background revalidation fetches fresh data.

```
|<------ Fresh (TTL) ------>|<-- Stale (staleTime) -->|<-- Expired -->|
0s                         300s                      600s
                             |                          |
                       Return stale data          Must wait for
                       + revalidate async          fresh load
```

**SWR entry metadata** (stored in L2/Redis):

| Field | Description |
|-------|-------------|
| `value` | The cached data |
| `cachedAt` | Timestamp when value was cached (ms) |
| `staleAt` | `cachedAt + TTL` — when value becomes stale |
| `expiresAt` | `staleAt + staleTime` — when value expires completely |

**Revalidation process:**

1. `getOrSet()` reads SWR entry from L2 (Redis)
2. If **fresh** (`now < staleAt`) — return immediately
3. If **stale** (`staleAt < now < expiresAt`) — return stale data, schedule background revalidation
4. If **expired** (`now > expiresAt`) — wait for fresh load (same as cache miss)
5. Background revalidation runs via `setImmediate()` (non-blocking, next event loop tick)
6. Only one revalidation per key at a time (deduplication via `shouldRevalidate()`)
7. On success — both L1 and L2 updated with fresh data
8. On failure — error logged, stale data preserved until expiry

::: info SWR is L2-only
SWR metadata (`staleAt`, `expiresAt`) is stored only in **L2 (Redis)**. L1 (memory) is updated when revalidation succeeds. This means SWR requires L2 to be enabled.
:::

## Configuration

```typescript
new CachePlugin({
  swr: {
    enabled: true,            // Enable globally (default: false)
    defaultStaleTime: 60,     // Default stale window in seconds (default: 60)
  },
})
```

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `false` | Enable SWR globally. When enabled, `getOrSet()` and `@Cached` use SWR flow by default. Can be overridden per call/decorator. |
| `defaultStaleTime` | `60` | Default stale window in seconds. Can be overridden per call. |

## Service API Usage

SWR works through `getOrSet()` — this is the only method that supports the full SWR flow (read stale + background revalidation).

```typescript
const user = await this.cache.getOrSet<User>(
  'user:123',
  () => this.repository.findOne('123'),
  {
    ttl: 300,                                // Fresh for 5 minutes
    swr: { enabled: true, staleTime: 300 },  // Stale for another 5 minutes
  }
);
```

### Enable SWR per call

SWR can be enabled per call even when globally disabled. This is useful when only specific methods need SWR:

```typescript
// Global SWR is off, but this call uses SWR
const user = await this.cache.getOrSet<User>(
  'user:123',
  () => this.repository.findOne('123'),
  {
    ttl: 300,
    swr: { enabled: true, staleTime: 300 },  // SWR for this call only
  }
);
```

### Disable SWR per call

```typescript
// Global SWR is on, but this call skips it
const user = await this.cache.getOrSet<User>(
  'user:123',
  () => this.repository.findOne('123'),
  {
    ttl: 300,
    swr: { enabled: false },  // No stale window for this call
  }
);
```

## Decorator Usage

`@Cached` uses `getOrSet()` internally, so SWR works fully with the decorator — stale data is served immediately while background revalidation refreshes the cache.

```typescript
@Cached({
  key: 'user:{0}',
  ttl: 300,
  swr: { enabled: true, staleTime: 300 },
})
async getUser(id: string): Promise<User> {
  return this.repository.findOne(id);
}
```

Or with the Service API directly:

<<< @/apps/demo/src/plugins/cache/swr-get-or-set.usage.ts{typescript}

## Cache States

| State | Condition | Behavior |
|-------|-----------|----------|
| Fresh | `now < staleAt` | Return immediately |
| Stale | `staleAt < now < expiresAt` | Return stale + revalidate in background |
| Expired | `now > expiresAt` | Wait for fresh load (cache miss) |

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Background revalidation fails | Error logged. Stale data is **preserved** until expiry — not invalidated. |
| Revalidation already in progress | Duplicate skipped (`shouldRevalidate()` returns false). |
| Redis unavailable during SWR read | Falls back to regular `getOrSet()` flow (cache miss → load). |
| Loader throws during fresh load | Error propagates to caller. No SWR entry created. |

## Best Practices

### Good TTL + staleTime Combos

| Data Type | TTL | staleTime | Total Window |
|-----------|-----|-----------|--------------|
| User profile | 5m | 5m | 10m |
| Product info | 1h | 30m | 1.5h |
| Config | 24h | 1h | 25h |
| Search results | 5m | 2m | 7m |

### Tips

- **Start conservative** — short staleTime first, increase based on monitoring
- **SWR + stampede** — both work together: `getOrSet()` uses stampede protection for fresh loads, SWR for background revalidation
- **Don't use SWR for security-critical data** — tokens, permissions, auth state must always be fresh

## Stale-If-Error

SWR answers a **freshness** question: "may I serve slightly old data while I
refresh in the background?" Stale-if-error (RFC 5861's second directive)
answers an **availability** question: "may I serve the last known value when
the loader FAILS?" They are independent toggles with separate windows:

```
staleAt   = now + ttl                     # fresh -> stale (SWR revalidates)
expiresAt = staleAt + staleTime           # end of the SWR window
keepUntil = expiresAt + staleIfError.window  # retained for error-serving only
```

Between `expiresAt` and `keepUntil` the value is **retained but invisible** to
the success path (a healthy loader reloads fresh data as usual). Only when the
loader throws does the cache fall back to it.

<<< @/apps/demo/src/plugins/cache/stale-if-error.setup.ts{typescript}

Per-call and per-method overrides mirror the plugin shape:

```typescript
await cache.getOrSet('report:q3', loadReport, {
  ttl: 3600,
  staleIfError: { enabled: true, window: 86400 },
});

@Cached({ ttl: 3600, staleIfError: { enabled: true, window: 86400 } })
async getReport(id: string) { ... }
```

**Semantics and guardrails:**

- **Lazy, request-driven.** There is no background timer: a failed loader is
  retried by the next request (concurrent retries are coalesced by stampede
  protection). If nobody asks, nothing refreshes.
- **`window` is always a finite number.** For a "practically infinite" outage
  budget set an explicit large value (e.g. 30 days) — an explicit number keeps
  Redis memory bounded. Invalid windows fail fast at bootstrap
  (`CacheConfigError`).
- **`shouldServe(error)` decides what qualifies** (default: any error). Exclude
  errors that mean the data is gone for good (404/410, revoked access) —
  serving those stale forever silently exposes dead data.
- **Observable by design.** Every stale-on-error serve emits a warn log and
  increments `redisx_cache_stale_if_error_served_total` — an outage cannot
  hide behind a green cache.
- **Memory cost is opt-in.** Entries of non-users keep exactly the previous
  TTL; only SIE-enabled entries are retained longer (ttl + staleTime + window).

::: tip SIE vs Circuit Breaker
Stale-if-error protects **reads through the cache**: last-known-good per key.
The [Circuit Breaker plugin](../circuit-breaker/) protects **any operation**
and stops hammering a dead upstream. For long outages they compose: breaker
fails fast, cache serves stale.
:::

## Next Steps

- [Cache Warming](./warmup) — Pre-populate cache on startup
- [Monitoring](./monitoring) — Track SWR performance
