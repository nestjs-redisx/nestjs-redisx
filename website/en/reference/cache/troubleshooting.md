---
title: Troubleshooting
description: Common issues and solutions
---

# Troubleshooting

Common issues and how to fix them.

## Cache Always Misses

**Symptoms:** Method always executes, no cache hits, database queries on every request.

### 1. Plugin not registered

```typescript
// Wrong — no CachePlugin
RedisModule.forRoot({ clients: { ... } })

// Correct
RedisModule.forRoot({
  clients: { ... },
  plugins: [new CachePlugin()],
})
```

### 2. Redis not running

```bash
redis-cli ping
# Should return: PONG
```

### 3. Wrong key syntax

`@Cached` and `@Cacheable` use **different** key interpolation:

```typescript
// @Cached — positional: {0}, {1}, {2}
@Cached({ key: 'user:{0}' })
async getUser(id: string) {}

// @Cacheable — named: {paramName}
@Cacheable({ key: 'user:{id}' })
async getUser(id: string) {}

// Wrong — mixing syntaxes
@Cached({ key: 'user:{id}' })     // {id} won't resolve, stays literal
@Cacheable({ key: 'user:{0}' })   // {0} won't resolve, stays literal
```

### 4. Object argument produces unstable key

`@Cached` uses `JSON.stringify()` for object arguments. Property order may vary:

```typescript
// Fragile — object serialized as JSON, key is long and order-dependent
@Cached({ key: 'products:{0}' })
async find(filter: ProductFilter) {}
// Key: products:{"category":"shoes","page":1}

// Better — use getOrSet() with a stable key builder
async find(filter: ProductFilter) {
  const key = `products:${filter.category}:p${filter.page}`;
  return this.cache.getOrSet(key, () => this.repo.find(filter), { ttl: 300 });
}
```

## L1 Cache Misses While L2 Hits

**Symptoms:** L1 hit rate is low, L2 hit rate is high. Stats show many L1 misses.

**Cause:** L1 and L2 have **independent TTLs**. L1 default is **60 seconds**, L2 default is **3600 seconds** (1 hour). After 60s, entries expire from L1 but remain in L2.

```typescript
new CachePlugin({
  l1: {
    enabled: true,
    maxSize: 1000,
    ttl: 300,           // Increase L1 TTL (default: 60s)
  },
  l2: {
    defaultTtl: 3600,   // L2 TTL (default: 3600s)
  },
})
```

::: tip
Keep L1 TTL shorter than L2 TTL. L1 is memory — bounded by `maxSize` and TTL. L2 is Redis — bounded by Redis `maxmemory`.
:::

## SWR Not Revalidating

**Symptoms:** Stale-while-revalidate configured, but background revalidation never triggers. Data only refreshes after full expiration.

**Cause:** The `@Cached` decorator uses `get()` for cache reads, which does not check SWR staleness. SWR revalidation only triggers through `getOrSet()`.

```typescript
// Won't trigger SWR revalidation on read
@Cached({
  key: 'data:{0}',
  swr: { enabled: true, staleTime: 120 },
})
async getData(id: string) { ... }

// Correct — use getOrSet() directly
async getData(id: string) {
  return this.cache.getOrSet(
    `data:${id}`,
    () => this.repository.findById(id),
    { ttl: 300, swr: { enabled: true, staleTime: 120 } },
  );
}
```

## varyBy Has No Effect

**Symptoms:** `varyBy` configured in `@Cached`, but all users/tenants share the same cache.

**Cause:** `varyBy` resolves values from `contextProvider`. If `contextProvider` is not configured in `CachePlugin`, `varyBy` is silently ignored.

```typescript
// Missing contextProvider — varyBy does nothing
new CachePlugin({
  l1: { maxSize: 1000 },
})

// Correct — provide context source
new CachePlugin({
  l1: { maxSize: 1000 },
  contextProvider: clsService,     // implements IContextProvider
  contextKeys: ['tenantId'],       // global context keys
})
```

## Stale Data After Update

**Symptoms:** Old data returned after update. Cache not invalidated.

### 1. Missing invalidation on mutations

```typescript
@InvalidateTags({
  tags: (id: string) => [`user:${id}`, 'users'],
})
async updateUser(id: string, data: UpdateDto) {
  return this.repository.update(id, data);
}
```

### 2. Tags mismatch between cache and invalidation

Tags used in `@Cached` must match tags used in `@InvalidateTags`:

```typescript
// Cache with tags
@Cached({
  key: 'user:{0}',
  tags: (id: string) => [`user:${id}`, 'users'],  // tag: 'user:123'
})
async getUser(id: string) {}

// Invalidate with SAME tags
@InvalidateTags({
  tags: (id: string) => [`user:${id}`],  // matches 'user:123'
})
async updateUser(id: string) {}

// Wrong — tag name doesn't match
@InvalidateTags({
  tags: (id: string) => [`users:${id}`],  // 'users:123' ≠ 'user:123'
})
```

### 3. Over-invalidation (cache always empty)

Broad tags cause excessive invalidation:

```typescript
// Bad — ANY user update clears ALL user caches
@InvalidateTags({ tags: ['users'] })
async updateUser(id: string) {}

// Better — only invalidate the specific user
@InvalidateTags({
  tags: (id: string) => [`user:${id}`],
})
async updateUser(id: string) {}
```

## Low Hit Rate

**Symptoms:** Hit rate below 50%, high database load.

**Diagnose:**

```typescript
const stats = await cache.getStats();

const l1Total = stats.l1.hits + stats.l1.misses;
const l2Total = stats.l2.hits + stats.l2.misses;

console.log('L1 hit rate:', l1Total > 0 ? (stats.l1.hits / l1Total * 100).toFixed(1) + '%' : 'N/A');
console.log('L2 hit rate:', l2Total > 0 ? (stats.l2.hits / l2Total * 100).toFixed(1) + '%' : 'N/A');
console.log('L1 size:', stats.l1.size);
```

**Common causes:**

| Cause | Fix |
|-------|-----|
| TTL too short | Increase `l2.defaultTtl` or per-key `ttl` |
| L1 too small | Increase `l1.maxSize` (more entries stay in memory) |
| Over-invalidation | Use specific tags instead of broad tags |
| High cardinality keys | Reduce key variations (e.g., don't include timestamps) |

## Slow Cache Lookups

**Symptoms:** Cache lookup takes >10ms.

**Check Redis latency:**

```bash
redis-cli --latency
# Should be <1ms on local network
```

**Enable L1 cache** to serve hot data from memory (sub-millisecond):

```typescript
new CachePlugin({
  l1: { enabled: true, maxSize: 1000 },
})
```

## Error Reference

Catch specific error classes for programmatic handling:

```typescript
import {
  CacheKeyError,
  SerializationError,
  LoaderError,
  StampedeError,
  TagInvalidationError,
} from '@nestjs-redisx/cache';
```

| Error class | Message format | When thrown |
|-------------|---------------|------------|
| `CacheKeyError` | `Invalid cache key "{key}": Key cannot be empty` | Empty key, whitespace, invalid characters, exceeds max length (1024) |
| `SerializationError` | `Serialization error: {message}` | `JSON.stringify` fails (circular refs), `JSON.parse` fails (corrupt data) |
| `LoaderError` | `Loader failed for key "{key}": {cause}` | Loader function in `getOrSet()` throws |
| `StampedeError` | `Stampede protection timeout for key "{key}" after {timeout}ms` | Waiting for concurrent loader exceeds `waitTimeout` (default: 10s) |
| `TagInvalidationError` | `Tag invalidation failed for "{tag}": {message}` | Redis error during tag-based invalidation |

::: info CacheKeyError validation rules
Keys must match `[a-zA-Z0-9\-_:.]` only. No spaces, no special characters. Maximum length: 1024 (configurable via `keys.maxLength`).
:::

## Enable Debug Logging

Cache services use NestJS `Logger`. Enable debug level to see cache hits/misses/revalidations:

```typescript
const app = await NestFactory.create(AppModule, {
  logger: ['log', 'error', 'warn', 'debug'],
});
```

Key debug messages:

| Source | Message |
|--------|---------|
| `CacheService` | `L1 hit for key: {key}` / `L2 hit for key: {key}` |
| `SwrManagerService` | `Starting revalidation for key: {key}` |
| `StampedeProtectionService` | `Failed to acquire distributed lock: ...` |
| `WarmupService` | `Cache warmup completed: X succeeded, Y failed (Zms)` |

## Debug Checklist

1. `CachePlugin` registered in `RedisModule.forRoot({ plugins: [...] })`
2. Redis running and accessible (`redis-cli ping`)
3. Correct decorator syntax (`{0}` for `@Cached`, `{paramName}` for `@Cacheable`)
4. Cache key is deterministic (no timestamps, no random values)
5. Tags match between `@Cached` and `@InvalidateTags`
6. `getStats()` shows expected hit/miss ratios
7. L1 TTL (default: 60s) is not too short for your use case
8. SWR uses `getOrSet()`, not `@Cached` decorator
9. `contextProvider` configured if using `varyBy`
10. Debug logging enabled to see cache behavior

## Next Steps

- [Monitoring](./monitoring) — Track performance
- [Overview](./index) — Back to overview
