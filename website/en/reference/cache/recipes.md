---
title: Recipes
description: Common caching patterns and real-world examples
---

# Recipes

Common caching patterns and real-world examples.

## 1. Cache-Aside with getOrSet (Recommended)

The most common pattern. `getOrSet()` handles cache lookup, stampede protection, and cache write in a single call.

<<< @/apps/demo/src/plugins/cache/recipes/cache-aside.usage.ts{typescript}

**Why `getOrSet` over `get`/`set`:**
- Anti-stampede protection — only one loader runs for concurrent requests with the same key
- Atomic — no window between "cache miss" and "cache write" where duplicates can occur
- Less code — single call instead of get → check → load → set

::: tip Tag invalidation cost
`invalidateTags()` deletes all keys linked to the given tags. Cost is O(number of keys per tag). Avoid tagging high-cardinality hot keys with a single broad tag — prefer specific tags like `user:123` over just `users` when possible.
:::

## 2. Reusable Cached Functions with wrap

`cache.wrap()` creates a reusable cached function — useful when the same loader is called from multiple places.

<<< @/apps/demo/src/plugins/cache/recipes/wrap.usage.ts{typescript}

## 3. @Cached Decorator

Declarative caching on method level. Best for simple key patterns with primitive arguments.

<<< @/apps/demo/src/plugins/cache/recipes/cached-decorator.usage.ts{typescript}

::: warning @Cached key and object arguments
`{0}`, `{1}` placeholders use `JSON.stringify()` for objects. This produces long, order-dependent keys (`{a:1, b:2}` and `{b:2, a:1}` produce different keys). **Use `@Cached` with primitive arguments** (string, number).

For DTOs, create a thin wrapper that extracts the stable ID:
```typescript
@Cached({ key: 'order:{0}' })
async getOrder(id: string) { return this.repo.findById(id); }

// Called from controller/handler:
async handleOrderRequest(dto: OrderDto) {
  return this.getOrder(dto.id); // Primitive key, cached
}
```

For complex query objects, use `getOrSet()` or `wrap()` with a custom key builder that produces a stable, short key.
:::

## 4. Conditional Caching

Skip caching based on input or result.

<<< @/apps/demo/src/plugins/cache/recipes/conditional.usage.ts{typescript}

| Option | When evaluated | Effect |
|--------|---------------|--------|
| `condition` | Before method | If `false`, skip cache entirely (always execute method) |
| `unless` | After method | If `true`, don't store result in cache |

::: tip Cache key is based on id only
The `options` argument is intentionally **not** part of the cache key (`key: 'order:{0}'` uses only `{0}` = id). The `fresh` flag bypasses caching entirely via `condition` — it doesn't create a separate cache entry. All callers share the same cached value for a given id.
:::

## 5. Pagination

Each page is a separate cache entry. Invalidate all pages when data changes.

<<< @/apps/demo/src/plugins/cache/recipes/pagination.usage.ts{typescript}

## 6. Computed / Expensive Calculations

Cache results of expensive computations. Invalidate programmatically when source data changes.

<<< @/apps/demo/src/plugins/cache/recipes/computed.usage.ts{typescript}

## 7. Multi-Tenant Caching

Separate cache per tenant using `varyBy` with a context provider (CLS / AsyncLocalStorage).

<<< @/apps/demo/src/plugins/cache/recipes/multi-tenant.usage.ts{typescript}

Resulting key: `data:item-5:_ctx_:tenantId.tenant-abc`

::: info varyBy requires contextProvider
`varyBy` resolves values from the configured `contextProvider` (CLS, AsyncLocalStorage), not from HTTP headers. Configure it in `CachePlugin`:

```typescript
new CachePlugin({
  contextProvider: clsService,    // implements IContextProvider
  contextKeys: ['tenantId'],      // global context keys for all @Cached methods
})
```

Use `varyBy` for per-method additions on top of global `contextKeys`.
:::

::: warning Tag invalidation scope
In the example above, `tags: ['data:item-5']` is shared across **all tenants**. Invalidating that tag clears `data:item-5` for every tenant. This is correct when the underlying data is the same for all tenants. If data differs per tenant and you need per-tenant invalidation, include tenant in the tag:

```typescript
// Per-tenant tags — requires tenantId as method argument
tags: (tenantId: string, dataId: string) => [`data:${tenantId}:${dataId}`],
```
:::

## 8. Stale-While-Revalidate (SWR)

Serve stale data instantly while refreshing in the background. Both `@Cached` and `getOrSet()` support full SWR behavior.

### With @Cached

```typescript
@Cached({
  key: 'catalog:categories',
  ttl: 300,
  tags: ['catalog'],
  swr: { enabled: true, staleTime: 120 },
})
async getCategories(): Promise<Category[]> {
  return this.repository.findAllCategories();
}
```

### With getOrSet()

<<< @/apps/demo/src/plugins/cache/recipes/swr.usage.ts{typescript}

`staleTime` is an **additional window after TTL** — not absolute age since write.

**Timeline** (ttl: 300, staleTime: 120):
- 0–300s: Fresh data served from cache
- 300–420s: Stale data served instantly, revalidation triggered in background
- 420s+: Cache expired, next request loads fresh data synchronously

## 9. Batch Operations

Load multiple items efficiently — fetch from cache first, load missing from DB, backfill cache. `getMany()` returns `Array<T | null>` — missing keys are strictly `null`, never `undefined`.

<<< @/apps/demo/src/plugins/cache/recipes/batch.usage.ts{typescript}

::: info setMany and strategy
`setMany()` supports `tags` per entry, but does not support `strategy` per entry. If you need per-entry strategy, use individual `set()` calls.
:::

## 10. Session Caching

<<< @/apps/demo/src/plugins/cache/recipes/session.usage.ts{typescript}

## Choosing the Right Pattern

| Pattern | When to use |
|---------|-------------|
| `getOrSet()` | Default choice — cache-aside with stampede protection |
| `wrap()` | Same loader reused in multiple places |
| `@Cached` | Simple methods with primitive arguments |
| `get()` / `set()` | Fine-grained control, conditional logic |
| `getMany()` / `setMany()` | Batch operations |

## Next Steps

- [Troubleshooting](./troubleshooting) — Debug common issues
- [Overview](./index) — Back to overview
