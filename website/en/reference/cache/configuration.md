---
title: Configuration
description: Complete configuration reference for Cache Plugin
---

# Configuration

Full reference for all Cache Plugin options.

## Basic Configuration

<<< @/apps/demo/src/plugins/cache/basic-config.setup.ts{typescript}

## Complete Options Reference

```typescript
new CachePlugin({
  // Register globally (default: false)
  // When true, CacheService is available in all modules without explicit import
  isGlobal: false,

  // L1 Memory Cache
  l1: {
    enabled: true,            // Enable L1 cache (default: true)
    maxSize: 1000,            // Max entries (default: 1000)
    ttl: 60,                  // Default TTL in seconds (default: 60)
    evictionPolicy: 'lru',    // 'lru' | 'lfu' (default: 'lru')
  },

  // L2 Redis Cache
  l2: {
    enabled: true,            // Enable L2 cache (default: true)
    defaultTtl: 3600,         // Default TTL in seconds (default: 3600)
    maxTtl: 86400,            // Max TTL cap in seconds (default: 86400)
    keyPrefix: 'cache:',      // Key prefix in Redis (default: 'cache:')
    clientName: 'default',    // Redis client name (default: 'default')
  },

  // Stampede Protection
  stampede: {
    enabled: true,            // Enable anti-stampede (default: true)
    lockTimeout: 5000,        // Lock TTL in ms (default: 5000)
    waitTimeout: 10000,       // Max wait time in ms (default: 10000)
    fallback: 'load',         // 'load' | 'error' | 'null' (default: 'load')
  },

  // Stale-While-Revalidate
  swr: {
    enabled: false,           // Enable SWR (default: false)
    defaultStaleTime: 60,     // Stale window in seconds (default: 60)
  },

  // Tag-Based Invalidation
  tags: {
    enabled: true,            // Enable tag system (default: true)
    indexPrefix: '_tag:',      // Tag index prefix (default: '_tag:')
    maxTagsPerKey: 10,         // Max tags per cache key (default: 10)
    ttl: 86400,               // Tag index TTL in seconds (default: same as l2.maxTtl)
  },

  // Cache Key Settings
  keys: {
    maxLength: 1024,          // Max key length (default: 1024)
    version: 'v1',            // Key version for length validation (default: 'v1')
    separator: ':',           // Key separator (default: ':')
  },

  // Cache Warming
  warmup: {
    enabled: false,           // Enable warmup on startup (default: false)
    keys: [],                 // Warmup key definitions
    concurrency: 10,          // Parallel warmup calls (default: 10)
  },

  // Context Provider (for multi-tenant / CLS)
  contextProvider: {
    get: (key) => clsService.get(key),  // Context value getter
  },
  contextKeys: ['tenantId', 'locale'],  // Keys to auto-append to cache keys

  // Event-Driven Invalidation
  invalidation: {
    enabled: true,            // Enable event invalidation (default: true)
    source: 'internal',       // 'internal' | 'amqp' | 'custom' (default: 'internal')
    deduplicationTtl: 60,     // Dedup TTL in seconds (default: 60)
    rules: [                  // Static invalidation rules
      {
        event: 'user.updated',
        tags: ['user:{userId}'],
        keys: ['user:{userId}:profile'],
        condition: (payload) => payload.active,
        priority: 10,
      },
    ],
    amqp: {                   // AMQP config (when source = 'amqp')
      exchange: 'cache.invalidation',
      queue: 'my-service.cache.invalidation',
      routingKeys: ['#'],
    },
  },
})
```

## Option Details

### `isGlobal`

When `true`, `CacheService` and other cache exports are available in all modules without explicit import. When `false` (default), the service is only available in the module where the plugin is registered.

### `keys.version`

The `version` string is used when validating key length. The full key for length validation is built as `version + separator + rawKey`. This ensures that if you later change the version, keys won't exceed `maxLength`. However, the version is **not** stored as part of the actual Redis key — only the raw key (with `l2.keyPrefix`) is stored.

### `invalidation.rules`

Static invalidation rules define automatic cache invalidation in response to events. Each rule has:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `event` | `string` | Yes | Event pattern. Supports wildcards: `user.*`, `*.updated`, `#` |
| `tags` | `string[]` | No | Tags to invalidate. Supports templates: `user:{userId}` |
| `keys` | `string[]` | No | Keys to invalidate directly. Supports templates: `user:{userId}:profile` |
| `condition` | `(payload) => boolean` | No | Only invalidate if condition returns true |
| `priority` | `number` | No | Higher priority rules are processed first (default: 0) |

Rules can also be registered dynamically via `InvalidationRegistry`.

### `invalidation.amqp`

When `source` is `'amqp'`, configure the AMQP connection:

| Field | Default | Description |
|-------|---------|-------------|
| `exchange` | `'cache.invalidation'` | Exchange to listen for invalidation events |
| `queue` | `'{serviceName}.cache.invalidation'` | Queue name for this service instance |
| `routingKeys` | `['#']` | Routing key patterns to subscribe (default: all events) |

## Configuration by Environment

<<< @/apps/demo/src/plugins/cache/async-config.setup.ts{typescript}

## Configuration Presets

### Production (High Traffic)

```typescript
new CachePlugin({
  l1: { enabled: true, maxSize: 10000, ttl: 120 },
  l2: { enabled: true, defaultTtl: 3600, maxTtl: 86400 },
  stampede: { enabled: true, lockTimeout: 10000 },
  swr: { enabled: true, defaultStaleTime: 300 },
  tags: { enabled: true },
})
```

### Development

```typescript
new CachePlugin({
  l1: { enabled: true, maxSize: 100, ttl: 30 },
  l2: { enabled: true, defaultTtl: 300 },
  stampede: { enabled: false },  // Simpler debugging
})
```

## Next Steps

- [Decorators](./decorators) — Learn @Cached, @Cacheable, @CacheEvict, @CachePut
- [Service API](./service-api) — Programmatic cache access
