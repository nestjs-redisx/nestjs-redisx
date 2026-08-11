---
title: 'Configuration Reference — Cache Plugin | NestJS RedisX'
description: 'Configure CachePlugin with l1 and l2 options, TTLs, eviction policies, stampede, SWR, varyBy, contextKeys, and keyPrefix for NestJS Redis caching.'
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

  // Deployment topology (default: 'l1-l2')
  // 'l1-only' runs entirely in local memory with NO Redis — see below.
  mode: 'l1-l2',

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
    fallback: 'load',         // On stampede timeout: 'load' | 'error' | 'null' (default: 'load')
  },

  // Stale-While-Revalidate
  swr: {
    enabled: false,           // Enable SWR (default: false)
    defaultStaleTime: 60,     // Stale window in seconds (default: 60)
  },

  // Stale-If-Error: serve the last known value when the loader FAILS,
  // for defaultWindow seconds beyond the normal expiry. Availability policy,
  // independent of SWR — see the SWR page for semantics and guardrails.
  staleIfError: {
    enabled: false,           // Opt-in (default: false)
    defaultWindow: 86400,     // Seconds; always finite (explicit = bounded memory)
    // shouldServe: (error) => !/404|410/.test(error.message),
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
    validation: 'safe',       // 'safe' (default) | 'strict' | 'off'
    // pattern: /^[a-z0-9:/-]+$/, // optional custom allowlist (overrides mode)
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

## Running without Redis (`l1-only`)

By default the cache is **`l1-l2`**: an in-memory L1 in front of a Redis L2,
which requires a reachable Redis connection. Set **`mode: 'l1-only'`** to run
the cache **entirely in local process memory, with no Redis** — the app boots
even when Redis is unreachable.

<<< @/apps/demo/src/plugins/cache/l1-only.setup.ts{typescript}

**What works in `l1-only`:** `get` / `set` / `getOrSet`, `getMany` / `setMany`,
`ttl`, tag invalidation, `invalidateByPattern`, SWR, stale-if-error, and
in-process singleflight (stampede coalescing) — all backed by an in-memory
store that keeps the **live** object (no serialization, so a value is stored
once and shared with L1, not duplicated — this matters for large values).

::: warning Single-instance only
`l1-only` is **per-process**: nothing is shared across instances and
invalidation (tags, events) affects only the local process. Use it for a single
instance, a sidecar/proxy, local development, or tests — not for cross-instance
cache coherence (use `l1-l2` with Redis for that).
:::

**Sizing.** The single in-memory tier is sized by the **`l1`** block
(`maxSize`, `evictionPolicy`, `ttl`); `l2.defaultTtl` / `l2.maxTtl` still supply
default TTLs.

**Fail-fast.** Because `l1-only` has no Redis, options that require one are
rejected at startup with a `CacheConfigError` (never silently ignored):

- a named `client` (there is no Redis client to select),
- `l1.enabled: false` (nothing would be left to cache),
- `l2.enabled: false` (redundant — the L2 tier is already in-memory),
- `invalidation.source: 'amqp'` (needs an external broker).

Tags, SWR and stale-if-error are **not** rejected — they work in memory.

> `RedisModule` still needs a `clients` block, but in `l1-only` the cache never
> opens that connection, so an unreachable host is fine.

**With `registerAsync`.** `mode` is a deployment-structural choice, so set it on
the async options (next to `useFactory`), not returned by the factory:

```typescript
CachePlugin.registerAsync({
  mode: 'l1-only',
  useFactory: () => ({ l1: { maxSize: 1000 } }),
})
```

## Allowed Key and Tag Characters

::: warning Cache keys and tags are validated — invalid characters throw
Cache **keys** are validated by `keys.validation` (default **`'safe'`**):

- **`'safe'`** — rejects only empty keys, whitespace, and control characters.
  Everything else is allowed, because Redis keys are binary-safe — so `/`, `?`,
  `=`, `%`, and unicode are valid, and **URL / path keys work out of the box**
  (`cache.getOrSet('http:/api/users/123', …)`).
- **`'strict'`** — allows only `A-Z a-z 0-9 - _ : .` (the pre-1.9.2 behavior),
  for teams that want to enforce clean, predictable keys.
- **`'off'`** — no character check (only empty + length).
- **`pattern`** — a custom `RegExp` allowlist that overrides the mode.

A violating key throws a `CacheKeyError`. For arbitrary URLs — especially with
query strings — prefer hashing the URL into a bounded key with `hashKey()`
(see [Service API](./service-api)) rather than storing the raw URL.

Cache **tags** are normalized to **lowercase** and may contain only
`a-z 0-9 - _ : .`; other characters throw `CacheError`, and tags are limited to
128 characters. (Tag rules are independent of `keys.validation`.)

These rules apply to every cache operation, including keys produced by the
`@Cached` / `@Cacheable` decorators after placeholder interpolation.
:::

## Failure Policy (fail-open vs fail-closed)

The cache service treats read and write failures differently:

- **Reads fail-open.** `get`, `has`, `ttl`, `getMany`, `getKeysByTag`, and
  invalid keys passed to reads do **not** throw. On a Redis error (or invalid
  key) the operation logs a warning and returns a miss (`null` / `false` /
  `[]` / `-1`). For `getOrSet`, a read failure falls through to the loader.
- **Writes fail-closed.** `set`, `delete`, `deleteMany`, `setMany`, `clear`,
  `invalidateTag(s)`, `invalidateByPattern`, and the write-back step of
  `getOrSet` **throw** on failure (`CacheError` / `CacheKeyError`). An invalid
  key passed to a write throws `CacheKeyError`.

## Option Details

### `stampede.fallback`

Controls what happens when stampede protection times out — i.e. a waiter exceeds
`waitTimeout` waiting for the in-flight loader to finish:

- `'load'` (default) — load directly without coordination and cache the result,
  so the caller still gets a value.
- `'null'` — return `null` without loading or caching.
- `'error'` — throw `StampedeError`.

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

Using `process.env` directly in plugin constructor:

<<< @/apps/demo/src/plugins/cache/async-config.setup.ts{typescript}

### Using registerAsync with ConfigService

For type-safe configuration via NestJS DI:

<<< @/apps/demo/src/plugins/cache/register-async.setup.ts{typescript}

::: tip
`registerAsync()` works with both `RedisModule.forRoot()` and `RedisModule.forRootAsync()`. You can mix sync and async plugins freely.
:::

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
