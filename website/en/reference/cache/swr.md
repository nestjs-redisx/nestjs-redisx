---
title: Stale-While-Revalidate
description: Serve stale data while refreshing in the background
---

# Stale-While-Revalidate (SWR)

Return cached data immediately, refresh in background.

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
| `enabled` | `false` | Enable SWR globally. When enabled, `getOrSet()` uses SWR flow by default. |
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

### Disable SWR per call

```typescript
// Override: disable SWR for this specific call
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

::: warning @Cached SWR limitation
`@Cached` uses separate `get()` + `set()` calls internally. When SWR is enabled on `@Cached`, it stores SWR metadata via `getOrSet()` on **write** (cache miss), but **read** uses plain `get()` which does not check `staleAt`/`expiresAt`. For full SWR behavior (return stale + background revalidation), use `getOrSet()` in your service directly.
:::

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

## Next Steps

- [Cache Warming](./warmup) — Pre-populate cache on startup
- [Monitoring](./monitoring) — Track SWR performance
