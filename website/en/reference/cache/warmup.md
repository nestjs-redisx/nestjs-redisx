---
title: Cache Warming
description: Pre-populate cache on application startup
---

# Cache Warming

Pre-load frequently accessed data into cache before traffic arrives.

## Why Warm Cache?

| Metric | Cold Start | Warmed |
|--------|-----------|--------|
| First request latency | 500ms | 5ms |
| DB queries (first minute) | 10,000 | 100 |
| Error rate | Higher | Normal |

## How It Works

Warmup runs automatically during NestJS `OnModuleInit` lifecycle — before the application starts accepting traffic.

1. `WarmupService.onModuleInit()` checks if warmup is enabled and keys are configured
2. Keys are split into **chunks** of size `concurrency` (default: 10)
3. Each chunk is processed via `Promise.allSettled()` — individual failures don't stop the batch
4. For each key, `getOrSet()` is called with the configured loader, TTL, and tags
5. After all chunks complete, a summary is logged: `N succeeded, M failed (Xms)`

```
Chunk 1: [key1, key2, ..., key10] → Promise.allSettled() → next chunk
Chunk 2: [key11, key12, ..., key20] → Promise.allSettled() → next chunk
...
```

::: info Warmup uses getOrSet() internally
Each warmup key is loaded via `getOrSet()`, which means:
- **Stampede protection** applies by default — concurrent warmup of the same key won't hit DB multiple times
- **SWR metadata** is created if SWR is enabled globally
- Data is stored in both **L1 and L2** (unless strategy overrides)
:::

## Configuration

```typescript
new CachePlugin({
  warmup: {
    enabled: true,
    concurrency: 10,      // Parallel warmup calls (default: 10)

    // Define keys with loaders
    keys: [
      {
        key: 'config:app',
        loader: () => loadAppConfig(),
        ttl: 3600,
      },
      {
        key: 'config:features',
        loader: () => loadFeatureFlags(),
        ttl: 3600,
      },
      {
        key: 'categories:all',
        loader: () => loadCategories(),
        ttl: 3600,
        tags: ['categories'],
      },
    ],
  },
})
```

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `false` | Enable cache warming on startup |
| `keys` | `[]` | Array of `IWarmupKey` entries to warm |
| `concurrency` | `10` | Max keys processed in parallel per chunk |

Each warmup key (`IWarmupKey`):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `key` | `string` | Yes | Cache key |
| `loader` | `() => Promise<unknown>` | Yes | Function to load the value |
| `ttl` | `number` | No | TTL in seconds |
| `tags` | `string[]` | No | Tags for invalidation |

## Warmup Strategies

### Strategy 1: Static Keys in Plugin Config

Best for data that can be loaded without DI services (static configs, environment-based data).

```typescript
new CachePlugin({
  warmup: {
    enabled: true,
    keys: [
      { key: 'config:app', loader: () => loadAppConfig(), ttl: 86400 },
      { key: 'config:features', loader: () => loadFeatureFlags(), ttl: 3600 },
      { key: 'categories:all', loader: () => loadCategories(), ttl: 3600 },
    ],
  },
})
```

::: warning Loader DI limitation
Loaders in plugin config are defined at **plugin construction time** — before the NestJS DI container is initialized. This means you **cannot inject services** (repositories, ConfigService, etc.) into these loaders. For data that requires DI services, use Strategy 2.
:::

### Strategy 2: Service-Based (Custom)

Best for data that requires injected services (database queries, external APIs).

<<< @/apps/demo/src/plugins/cache/warmup-service-based.usage.ts{typescript}

::: info getOrSet vs set for warmup
Use `getOrSet()` instead of `set()` for warmup — it provides stampede protection and SWR integration. If you use `set()`, you lose these benefits.
:::

## Logging

`WarmupService` logs at two levels:

| Level | Message | When |
|-------|---------|------|
| `LOG` | `Starting cache warmup for N keys...` | Warmup starts |
| `LOG` | `Cache warmup completed: X succeeded, Y failed (Zms)` | Warmup finishes |
| `DEBUG` | `Warming up key: {key}` | Each key starts |
| `DEBUG` | `Successfully warmed up key: {key}` | Each key succeeds |
| `ERROR` | `Failed to warm up key {key}: ...` | Each key fails |

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Individual loader fails | Error logged at ERROR level. Other keys continue. |
| All loaders fail | All errors logged. Application starts normally. |
| Redis unavailable | Each `getOrSet()` fails. Errors logged, app starts. |
| Warmup disabled or no keys | `onModuleInit()` returns immediately (no-op). |

Warmup uses `Promise.allSettled()` — failures never prevent application startup.

```typescript
warmup: {
  enabled: true,
  keys: [
    { key: 'key1', loader: () => loadKey1(), ttl: 60 },
    { key: 'key2', loader: () => loadKey2(), ttl: 60 },  // If this fails...
    { key: 'key3', loader: () => loadKey3(), ttl: 60 },  // ...this still runs
  ],
}
```

## Best Practices

### Do

```typescript
// Warm frequently accessed data
{ key: 'top-products', loader: () => repo.findTopSelling(100), ttl: 3600 }

// Use reasonable concurrency
warmup: { concurrency: 10 }

// Set appropriate TTLs
{ key: 'config', loader: () => loadConfig(), ttl: 86400 }  // Config rarely changes
```

### Don't

```typescript
// Don't warm everything
{ key: 'all-products', loader: () => repo.findAll() }  // 1M products!

// Don't use too high concurrency
warmup: { concurrency: 1000 }  // Will overload DB

// Don't warm rarely accessed data
{ key: 'user:inactive:123', loader: () => loadUser('123') }  // Waste of resources
```

## Next Steps

- [Serializers](./serializers) — Data serialization options
- [Monitoring](./monitoring) — Track cache performance
