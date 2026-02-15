---
title: Core Concepts
description: Understanding L1/L2 cache layers, TTL, keys, strategies, and cache flow
---

# Core Concepts

Before diving into implementation, understand these fundamental concepts.

## Cache Layers

NestJS RedisX implements a **two-layer caching architecture**.

### L1 Cache (Memory)

| Property | Value |
|----------|-------|
| **Storage** | In-process memory (LRU/LFU-backed Map) |
| **Speed** | ~0.1ms |
| **Scope** | Per application instance |
| **Capacity** | Limited by `l1.maxSize` |
| **Persistence** | None (lost on restart) |
| **Best for** | Hot data, frequent reads |

### L2 Cache (Redis)

| Property | Value |
|----------|-------|
| **Storage** | Redis server |
| **Speed** | ~1-5ms (network) |
| **Scope** | Shared across all instances |
| **Capacity** | Redis memory limit |
| **Persistence** | Optional (RDB/AOF) |
| **Best for** | Distributed cache, larger data |

### Cache Flow

```
Request → L1 Hit? → Return
              ↓ Miss
         L2 Hit? → Store in L1 → Return
              ↓ Miss
         Load from DB → Store in L2 → Store in L1 → Return
```

## Cache Strategy

Control which layers store a cached value:

| Strategy | L1 | L2 | Use Case |
|----------|----|----|----------|
| `'l1-l2'` (default) | Yes | Yes | Most cases |
| `'l1-only'` | Yes | No | Ephemeral data, no Redis overhead |
| `'l2-only'` | No | Yes | Large data, shared across instances |

```typescript
// Per decorator
@Cached({ key: 'user:{0}', strategy: 'l1-only' })

// Per service call
await cache.set('key', value, { strategy: 'l2-only' });
```

## Cache Keys

### Key Structure in Redis

The final key stored in Redis is composed of:

```
[l2.keyPrefix][raw key]
```

| Part | Default | Example | Description |
|------|---------|---------|-------------|
| `l2.keyPrefix` | `cache:` | `cache:` | Configurable prefix for all cache keys |
| Raw key | — | `user:123` | The key you specify in code |

Full example: `cache:user:123`

### Dynamic Keys

There are two key interpolation styles depending on the decorator:

**@Cached** — positional `{0}`, `{1}`:

```typescript
@Cached({ key: 'user:{0}' })
async getUser(id: string) { }
// Result key: "user:123"

// Without key option — auto-generated:
@Cached({ ttl: 300 })
async getUser(id: string) { }
// Result key: "UserService:getUser:123"
```

**@Cacheable** — named `{paramName}`:

```typescript
@Cacheable({ key: 'user:{id}' })
async getUser(id: string) { }
// Result key: "user:123"

// Nested object property
@Cacheable({ key: 'user:{dto.userId}' })
async getUser(dto: GetUserDto) { }
// Result key: "user:456"
```

## TTL (Time To Live)

All TTL values are in **seconds**.

### TTL Hierarchy

| Priority | Source | Example | Wins when |
|----------|--------|---------|-----------|
| 1 (highest) | Decorator / call option | `@Cached({ ttl: 30 })` | Always |
| 2 | Plugin config | `l2: { defaultTtl: 300 }` | No decorator TTL |
| 3 (lowest) | Global default | 3600 | Nothing configured |

### maxTtl Validation

The `l2.maxTtl` setting (default: 86400 = 24h) enforces an upper bound. TTL values exceeding `maxTtl` will cause a validation error:

```typescript
new CachePlugin({
  l2: { defaultTtl: 3600, maxTtl: 86400 },
})

// This works
await cache.set('key', value, { ttl: 3600 });    // OK

// This throws CacheError
await cache.set('key', value, { ttl: 100000 });  // Error: TTL exceeds maximum
```

### L1 TTL Capping

L1 TTL is automatically capped to the configured `l1.ttl` (default: 60s). If a value is stored with `ttl: 3600`, L1 gets `min(3600, 60) = 60s`, while L2 gets the full 3600s.

### TTL Best Practices

| Data Type | L1 TTL | L2 TTL | Reason |
|-----------|--------|--------|--------|
| User session | 5m | 30m | Frequently accessed |
| Product catalog | 1m | 1h | Changes rarely |
| Search results | 30s | 10m | Stale OK briefly |
| Real-time data | — | 30s | Use `l2-only` strategy |
| Static config | 10m | 24h | Almost never changes |

## L1 Eviction Policy

When L1 cache reaches `maxSize`, entries must be evicted. Two policies are available:

| Policy | Config Value | Best For |
|--------|-------------|----------|
| **LRU** (Least Recently Used) | `'lru'` (default) | General use, hot data |
| **LFU** (Least Frequently Used) | `'lfu'` | Stable popularity patterns |

```typescript
new CachePlugin({
  l1: { maxSize: 1000, evictionPolicy: 'lfu' },
})
```

See [Eviction Strategies](./strategies) for details.

## Tag-Based Invalidation

Tags let you group related cache entries and invalidate them together without knowing individual keys.

```typescript
// Tag entries when caching
@Cached({
  key: 'user:{0}',
  tags: (id: string) => [`user:${id}`, 'users'],
})
async getUser(id: string) { }

// Invalidate all entries tagged 'users'
await cache.invalidateTags(['users']);
```

See [Tag Invalidation](./tags) for details.

## Stampede Protection

When a popular cache entry expires, many requests may try to reload it simultaneously — overloading the database. Stampede protection ensures only **one** request loads the data while others wait.

Enabled by default. Uses local singleflight + distributed Redis lock.

```typescript
// Automatic with getOrSet
const user = await cache.getOrSet('user:123', () => db.findUser('123'));
```

See [Anti-Stampede](./stampede) for details.

## Stale-While-Revalidate (SWR)

Return cached data immediately even if stale, while refreshing in the background.

```
|<--- Fresh (TTL) --->|<--- Stale (staleTime) --->|<-- Expired -->|
0s                    60s                         120s
                       |                            |
                 Return stale                  Must fetch
                 + refresh async
```

```typescript
@Cached({
  key: 'user:{0}',
  ttl: 300,
  swr: { enabled: true, staleTime: 300 },
})
```

See [Stale-While-Revalidate](./swr) for details.

## Context Enrichment

For multi-tenant applications, cache keys can be automatically enriched with context values (tenant ID, locale, etc.) so different tenants don't share cached data.

```typescript
new CachePlugin({
  contextProvider: {
    get: (key) => clsService.get(key),  // e.g., nestjs-cls
  },
  contextKeys: ['tenantId'],
})
```

With this config, a key `user:123` automatically becomes `user:123:_ctx_:tenantId.acme` in Redis.

### Per-Method Control

```typescript
// Override global context keys
@Cached({ key: 'data:{0}', contextKeys: ['tenantId', 'locale'] })

// Disable context for global data
@Cached({ key: 'config:app', skipContext: true })

// Additional context-based variation (resolved from contextProvider)
@Cached({ key: 'products', varyBy: ['locale', 'currency'] })
```

See [Configuration](./configuration) for full context provider setup.

## Next Steps

- [Configuration](./configuration) — Full configuration reference
- [Decorators](./decorators) — Learn @Cached, @Cacheable, @CacheEvict, @CachePut
- [Service API](./service-api) — Programmatic cache access
