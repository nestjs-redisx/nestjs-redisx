---
title: Decorators
description: "Cached, Cacheable, CacheEvict, CachePut, InvalidateTags, and InvalidateOn decorator reference"
---

# Decorators

Declarative caching with method decorators.

## Overview

The cache module provides two decorator families:

### Proxy-Based (Recommended)

Work on **any Injectable** class (services, repositories, etc.) — not limited to HTTP controllers.

| Decorator | Purpose | When Runs |
|-----------|---------|-----------|
| `@Cached` | Cache method result | Before method |
| `@InvalidateTags` | Invalidate by tags | Before/After method |
| `@InvalidateOn` | Invalidate + publish event | After method |

### Metadata-Based (Spring-Style)

Require `DeclarativeCacheInterceptor` in the request pipeline. Only work in **controller context** (HTTP, GraphQL, or any context with `ExecutionContext` and the interceptor attached). They do **not** work on plain service methods called outside the interceptor chain.

| Decorator | Purpose | When Runs |
|-----------|---------|-----------|
| `@Cacheable` | Cache method result | Before method |
| `@CacheEvict` | Invalidate cache | Before/After method |
| `@CachePut` | Update cache with result | After method |

**Setup for metadata-based decorators:**

<<< @/apps/demo/src/plugins/cache/decorators/interceptor-setup.setup.ts{typescript}

::: tip Why two families?
`@Cached` is the recommended, full-featured approach — it works everywhere and supports SWR, varyBy, contextKeys, and unless. The Spring-style decorators (`@Cacheable`/`@CacheEvict`/`@CachePut`) exist for developers who prefer the familiar Spring Cache pattern with separated concerns (read / write / evict).
:::

## Why @Cached Works Inside Services (Self-Invocation)

`@Cached` replaces method descriptors directly on the class prototype — no proxy objects wrapping the instance. Internal calls like `this.method()` go through caching automatically, because the prototype already contains the wrapped version before NestJS creates any instance.

| Edge Case | Status | Why |
|-----------|--------|-----|
| Self-invocation (`this.method()`) | ✅ Works | Descriptor replacement on prototype, not proxy object |
| Background jobs / cron / RMQ | ✅ Works | No dependency on HTTP pipeline or `ExecutionContext` |
| Callback extraction (`const fn = svc.method`) | ⚠️ Standard JS caveat | `this` lost — use arrow wrapper or `.bind()` |
| Inheritance without override | ✅ Works | Prototype chain preserved |
| Inheritance with override | ⚠️ Re-apply decorator | Override creates new descriptor |
| Object args in key template | ⚠️ Documented | `JSON.stringify` — order-dependent keys |

## Edge Cases & Gotchas

Details on each item from the table above.

### Callback Extraction — Standard JS Caveat

Extracting a method as a standalone function loses `this` context. This is standard JavaScript behavior, not specific to RedisX:

```typescript
// ❌ this is undefined — will throw
const fn = service.getUser;
await fn('123');

// ❌ same issue with array methods
ids.map(service.getUser);

// ✅ Arrow wrapper preserves context
ids.map(id => service.getUser(id));

// ✅ Explicit bind works too
ids.map(service.getUser.bind(service));
```

### Inheritance — Works with Caveat

Decorated methods are inherited normally. However, if you override a decorated method, the override **does not inherit the decorator** — you must re-apply it:

```typescript
class BaseService {
  @Cached({ key: 'item:{0}' })
  async getItem(id: string) { ... }
}

class ExtendedService extends BaseService {
  // ✅ Inherits @Cached from BaseService (no override)
}

class OverrideService extends BaseService {
  // ⚠️ Override creates new descriptor — @Cached is lost
  async getItem(id: string) {
    const item = await super.getItem(id); // ✅ super still cached
    return { ...item, extra: true };
  }

  // ✅ Re-apply decorator on override
  @Cached({ key: 'item:{0}' })
  async getItemCached(id: string) { ... }
}
```

### Object Arguments in Key Templates

`{0}`, `{1}` placeholders use `JSON.stringify()` for objects. This produces **order-dependent, potentially long keys**:

```typescript
// ⚠️ Different key despite same data
@Cached({ key: 'search:{0}' })
async search(filters: SearchDto) { }
// { a: 1, b: 2 } → 'search:{"a":1,"b":2}'
// { b: 2, a: 1 } → 'search:{"b":2,"a":1}'  ← Different key!
```

**Recommendations for object arguments:**

```typescript
// ✅ Best: Use primitive arguments with @Cached
@Cached({ key: 'user:{0}' })
async getUser(id: string) { }

// ✅ For DTOs: Extract stable ID and pass as first arg
@Cached({ key: 'order:{0}' })
async getOrder(orderId: string) { }

async getOrderFromDto(dto: OrderDto) {
  return this.getOrder(dto.id); // Primitive key, cached
}

// ✅ For complex queries: Use programmatic getOrSet with custom key
async search(filters: SearchDto) {
  const key = `search:${filters.category}:${filters.sort}:${filters.page}`;
  return this.cache.getOrSet(key, () => this.repo.search(filters));
}
```

## How Cache Keys Are Built

Understanding the key pipeline helps debug "why is my key different?" issues.

```
1. Base key
   ├─ Explicit: @Cached({ key: 'user:{0}' })  →  "user:123"
   └─ Auto:     @Cached({ ttl: 300 })          →  "UserService:getUser:123"

2. Context enrichment (if contextProvider configured and skipContext !== true)
   ├─ contextKeys (per-decorator or global) resolved from contextProvider
   ├─ varyBy keys resolved from contextProvider (added to contextKeys)
   └─ All context keys sorted alphabetically — order is deterministic
   Result: "user:123:_ctx_:locale.en:tenantId.acme"

3. L2 prefix (added by Redis store, not visible in decorator)
   Result in Redis: "cache:user:123:_ctx_:locale.en:tenantId.acme"
```

| Option | Scope | Source | Effect |
|--------|-------|--------|--------|
| `contextKeys` | Per-decorator (overrides global) | `contextProvider` | Replaces global contextKeys for this method |
| `varyBy` | Per-decorator (additive) | `contextProvider` | Adds extra context keys on top of contextKeys |
| `skipContext` | Per-decorator | — | Disables all context enrichment |
| `namespace` | `@Cacheable` only | Static string | Prepends `namespace:` to key |

::: warning
`@Cached` does **not** have `namespace`. Use `key` prefix instead: `@Cached({ key: 'myapp:user:{0}' })`.
:::

## @Cached (Recommended)

Proxy-based decorator — works on any Injectable class.

### Basic Usage

<<< @/apps/demo/src/plugins/cache/decorators/cached-basic.usage.ts{typescript}

### Auto-Generated Key

When `key` is not specified, a key is generated automatically as `ClassName:methodName:args`:

```typescript
@Cached({ ttl: 300 })
async getUser(id: string) { }
// Key: "UserService:getUser:123"

@Cached({ ttl: 300 })
async search(query: string, limit: number) { }
// Key: "UserService:search:hello:10"
```

### Full Options

```typescript
@Cached({
  key: 'user:{0}',                    // Cache key ({0}, {1} for positional args)
  ttl: 300,                           // TTL in seconds
  tags: ['users'],                    // Static tags
  strategy: 'l1-l2',                  // 'l1-only' | 'l2-only' | 'l1-l2'
  condition: (id) => id !== 'admin',  // Skip cache if false
  unless: (result) => !result,        // Don't cache if true
  varyBy: ['locale', 'currency'],     // Additional context keys (from contextProvider)
  swr: { enabled: true, staleTime: 60 },  // Stale-while-revalidate
  contextKeys: ['tenantId'],          // Override global contextKeys
  skipContext: false,                 // Enable context enrichment (default)
})
```

### Key Templates

`@Cached` uses positional placeholders `{0}`, `{1}`, etc.:

```typescript
// First argument
@Cached({ key: 'user:{0}' })
async getUser(id: string) { }

// Multiple arguments
@Cached({ key: 'org:{0}:user:{1}' })
async getOrgUser(orgId: string, userId: string) { }
```

### Dynamic Tags

```typescript
@Cached({
  key: 'user:{0}',
  tags: (id: string) => [`user:${id}`, 'users'],
})
async getUser(id: string) { }
```

If the tags function throws, the error is caught and the method result is returned without caching.

### Conditional Caching

```typescript
@Cached({
  key: 'search:{0}',
  // Only cache if condition passes (before execution)
  condition: (query: string) => query.length > 2,
  // Skip caching if result matches (after execution)
  unless: (result: User[]) => result.length === 0,
})
async searchUsers(query: string): Promise<User[]> { }
```

### VaryBy

Adds additional context keys to the cache key, resolved from `contextProvider`. This is **not** HTTP headers — values come from CLS / AsyncLocalStorage / custom context provider.

Requires `contextProvider` to be configured in plugin options. Ignored if no contextProvider.

```typescript
// Different cache entries per locale and currency
@Cached({
  key: 'products:list',
  varyBy: ['locale', 'currency'],
})
async getProducts(): Promise<Product[]> { }
// Key with context: "products:list:_ctx_:currency.USD:locale.en"
```

### Context Keys

`contextKeys` **overrides** global contextKeys for this specific method. `varyBy` **adds** to them.

```typescript
// Override global context — only use tenantId for this method
@Cached({
  key: 'products:{0}',
  contextKeys: ['tenantId'],
})
async getProducts(category: string) { }

// No context at all — shared across all tenants
@Cached({
  key: 'config:app',
  skipContext: true,
})
async getAppConfig() { }
```

### Default Behaviors

| Scenario | Behavior |
|----------|----------|
| Method returns `null` / `undefined` | **Cached by default.** Use `unless: (r) => r == null` to skip. |
| Concurrent cache misses | **Stampede protected.** Only one call executes the method, others wait for result. |
| Redis connection error | **Fail-open.** Method executes normally, error logged to console. |
| Cache key validation fails | **Fail-open on read**, fail-closed on write (throws `CacheKeyError`). Key must be non-empty, no whitespace, only `a-zA-Z0-9_-:.`, max 1024 chars (configurable via `keys.maxLength`). |
| Tags function throws | Error caught, result returned without caching. |
| `strategy: 'l1-l2'` but L1 disabled | Only L2 is used. No error. |
| `strategy: 'l1-only'` but L1 disabled | Cache is effectively skipped. |

## @InvalidateTags

Proxy-based — works on any Injectable class.

<<< @/apps/demo/src/plugins/cache/decorators/invalidate-tags.usage.ts{typescript}

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `tags` | `string[] \| ((...args) => string[])` | — | Tags to invalidate (required) |
| `when` | `'before' \| 'after'` | `'after'` | When to invalidate |

### Default Behaviors

| Scenario | Behavior |
|----------|----------|
| `when: 'after'` and method throws | **Invalidation does NOT run.** The error propagates before invalidation is reached. |
| `when: 'after'` and invalidation fails | Error caught and logged, method result still returned. No race condition — invalidation is `await`ed. |
| `when: 'before'` and invalidation fails | Error caught and logged, method still executes. |
| Tags function throws | Error caught, method still executes. |

## @InvalidateOn

Proxy-based — works on any Injectable class. Invalidates cache after method execution and **optionally publishes named events** for distributed invalidation across service instances.

::: info How it works
`@InvalidateOn` always runs **after** the method. The `events` field defines **event names to publish** (not external triggers). The decorator:
1. Executes the method
2. Invalidates specified tags/keys locally
3. If `publish: true`, emits events so other nodes (via AMQP, Redis Pub/Sub, etc.) can perform the same invalidation
:::

<<< @/apps/demo/src/plugins/cache/decorators/invalidate-on.usage.ts{typescript}

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `events` | `string[]` | — | Event names to categorize/publish this invalidation (required) |
| `tags` | `string[] \| ((result, args) => string[])` | — | Tags to invalidate |
| `keys` | `string[] \| ((result, args) => string[])` | — | Keys to invalidate directly |
| `condition` | `(result, args) => boolean` | — | Only invalidate if returns true |
| `publish` | `boolean` | `false` | Publish events for distributed invalidation (requires `invalidation.source: 'amqp'` or `'custom'` in plugin config) |

### Default Behaviors

| Scenario | Behavior |
|----------|----------|
| Method throws | **Invalidation does NOT run.** The error propagates before invalidation is reached. |
| Invalidation fails | Error caught and logged, method result still returned. No race condition — invalidation is `await`ed. |
| Tags/keys function throws | Error caught and logged, method result still returned. |
| `condition` returns false | Invalidation skipped, method result returned as-is. |
| `publish: true` but no event service | Invalidation runs locally, publishing silently skipped. |

## @Cacheable (Spring-Style)

Metadata-based decorator using `{paramName}` interpolation. **Requires `DeclarativeCacheInterceptor`** in the request pipeline.

### Basic Usage

<<< @/apps/demo/src/plugins/cache/decorators/cacheable-basic.usage.ts{typescript}

### Full Options

```typescript
@Cacheable({
  key: 'user:{id}',                    // Cache key ({paramName} interpolation, required)
  ttl: 300,                            // TTL in seconds (default: 3600)
  tags: ['users'],                     // Static tags or function
  condition: (id) => id !== 'admin',   // Cache only if true
  keyGenerator: (...args) => 'key',    // Custom key generator
  namespace: 'myapp',                  // Namespace prefix
})
```

### Key Templates

`@Cacheable` uses named parameter interpolation `{paramName}`:

```typescript
// Parameter by name
@Cacheable({ key: 'user:{id}' })

// Nested property
@Cacheable({ key: 'user:{dto.id}' })

// Multiple parameters
@Cacheable({ key: 'org:{orgId}:user:{userId}' })
```

## @CacheEvict (Spring-Style)

Metadata-based decorator for cache invalidation. **Requires `DeclarativeCacheInterceptor`.**

Uses `beforeInvocation` (boolean) instead of `when` ('before'/'after') — consistent with Spring Cache convention.

### Basic Usage

<<< @/apps/demo/src/plugins/cache/decorators/cache-evict-basic.usage.ts{typescript}

### Full Options

```typescript
@CacheEvict({
  keys: ['user:{id}', 'users:list'],   // Keys to evict ({paramName} templates)
  tags: ['users', 'user-lists'],       // Tags to invalidate (static only)
  allEntries: false,                   // Clear entire cache (default: false)
  beforeInvocation: false,             // Evict before method (default: false)
  condition: (...args) => true,        // Only evict if true
  keyGenerator: (...args) => ['key'],  // Custom key generator
  namespace: 'myapp',                  // Namespace prefix
})
```

::: warning
`@CacheEvict` does **not** support wildcard patterns (`user:*`) in keys. Use `tags` for bulk invalidation instead.
`@CacheEvict` tags are **static only** (`string[]`). For dynamic tags use `@InvalidateTags` (proxy-based).
:::

## @CachePut (Spring-Style)

Always execute method and update cache with result. **Requires `DeclarativeCacheInterceptor`.**

### Basic Usage

<<< @/apps/demo/src/plugins/cache/decorators/cache-put-basic.usage.ts{typescript}

### Full Options

```typescript
@CachePut({
  key: 'user:{id}',                    // Cache key ({paramName} interpolation, required)
  ttl: 3600,                           // TTL in seconds (default: 3600)
  tags: ['users'],                     // Static tags or function
  condition: (id) => id !== 'admin',   // Only cache if true
  keyGenerator: (...args) => 'key',    // Custom key generator
  namespace: 'myapp',                  // Namespace prefix
  cacheNullValues: false,              // Cache null/undefined results (default: false)
})
```

| Decorator | Checks Cache | Always Executes | Updates Cache |
|-----------|--------------|-----------------|---------------|
| `@Cacheable` | Yes | No (if hit) | On miss |
| `@CachePut` | No | Yes | Always |

## Combining Decorators

### Proxy-Based (Recommended)

<<< @/apps/demo/src/plugins/cache/decorators/combining-proxy.usage.ts{typescript}

### Metadata-Based (Spring-Style)

<<< @/apps/demo/src/plugins/cache/decorators/combining-metadata.usage.ts{typescript}

::: warning @CacheEvict after timing
When `beforeInvocation: false` (default), eviction runs as fire-and-forget — the Promise is **not awaited**. For awaited invalidation, use `@InvalidateTags` (proxy-based) instead.
:::

## @Cached vs @Cacheable

| Feature | `@Cached` | `@Cacheable` |
|---------|-----------|-------------|
| Mechanism | Proxy-based | Metadata + Interceptor |
| Works on | Any Injectable | Controller context only |
| Works outside HTTP pipeline | Yes (services, workers, cron, RMQ) | No (requires `ExecutionContext`) |
| Key syntax | `{0}`, `{1}` (positional) | `{paramName}` (named) |
| Auto-generated key | Yes (`Class:method:args`) | No |
| SWR support | Yes | No |
| Key pipeline (contextProvider, varyBy, contextKeys, auto key) | Yes | No (interceptor metadata only) |
| `unless` | Yes | No |
| `namespace` | No (use key prefix) | Yes |
| Anti-stampede | Yes (via `getOrSet`) | No |
| Null caching control | Yes (`unless`) | No (`@CachePut`: `cacheNullValues`) |
| Invalidation timing | `@InvalidateTags`: `when` | `@CacheEvict`: `beforeInvocation` |
| Recommended | **Yes** | For Spring-style patterns |

## Next Steps

- [Service API](./service-api) — Programmatic cache access
- [Tag Invalidation](./tags) — Advanced tag patterns
