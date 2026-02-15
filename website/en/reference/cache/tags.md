---
title: Tag-Based Invalidation
description: Group and invalidate cache entries by tags
---

# Tag-Based Invalidation

Invalidate related cache entries without knowing their keys.

## The Problem

Without tags, you need to track every key that contains user data — easy to miss some.

## The Solution

Tag keys when caching, invalidate by tag later.

## How Tags Work

Tags are stored as **Redis SETs**. Each tag maintains a set of cache keys that belong to it.

```
Redis structure:
  cache:_tag:users          → SET { "cache:user:1", "cache:user:2", "cache:users:list:1" }
  cache:_tag:user:123       → SET { "cache:user:123" }
  cache:_tag:org:456        → SET { "cache:user:123", "cache:user:789" }
```

When you invalidate a tag, the service:
1. Gets all cache keys from the tag SET (`SMEMBERS`)
2. Deletes those keys from both L1 (memory) and L2 (Redis)
3. Deletes the tag SET itself

::: info
`invalidateTags(['a', 'b', 'c'])` runs invalidation **sequentially** per tag (not as a single batch). For high-throughput scenarios, keep the tags list short.
:::

## Tag Validation Rules

Tags are validated through the `Tag` value object. Invalid tags throw `CacheError`.

| Rule | Constraint |
|------|-----------|
| Not empty | After trimming, length must be > 0 |
| Lowercase | Tags are **automatically lowercased** |
| No whitespace | Spaces, tabs, newlines forbidden |
| Allowed characters | `a-z0-9`, `-`, `_`, `:`, `.` only |
| Max length | 128 characters (default) |
| Max tags per key | 10 (default, configurable via `tags.maxTagsPerKey`) |

::: warning
Tags are **lowercased automatically**. `User:123` becomes `user:123`. Keep this in mind when invalidating — always use lowercase tag names.
:::

## Basic Usage

### With @Cached Decorator

```typescript
// Tag on cache
@Cached({
  key: 'user:{0}',
  tags: (id: string) => [`user:${id}`, 'users'],
})
async getUser(id: string): Promise<User> {
  return this.repository.findOne(id);
}

// Invalidate by tag
@InvalidateTags({
  tags: (id: string) => [`user:${id}`, 'users'],
  when: 'after',
})
async updateUser(id: string, data: UpdateDto): Promise<User> {
  return this.repository.update(id, data);
}
```

### With @InvalidateOn (Distributed)

```typescript
// Invalidate locally + publish to other nodes
@InvalidateOn({
  events: ['user.deleted'],
  tags: (result, [id]) => [`user:${id}`, 'users'],
  publish: true,
})
async deleteUser(id: string): Promise<void> {
  await this.repository.delete(id);
}
```

### With @Cacheable/@CacheEvict Decorators

Requires `DeclarativeCacheInterceptor` — works in controller context only.

<<< @/apps/demo/src/plugins/cache/tags-cacheable-evict.usage.ts{typescript}

::: info
`@CacheEvict` supports **static tags only** (`string[]`). For dynamic tags based on method arguments, use `@InvalidateTags` (proxy-based).
:::

### With Service API

```typescript
// Set with tags
await this.cache.set('user:123', user, {
  tags: ['users', 'user:123', 'org:456'],
});

// Invalidate single tag
await this.cache.invalidate('users');

// Invalidate multiple tags
await this.cache.invalidateTags(['users', 'products']);

// Invalidate by key pattern (uses Redis SCAN)
await this.cache.invalidateByPattern('user:*');

// Get keys by tag
const keys = await this.cache.getKeysByTag('users');
```

## Tag Patterns

### Entity Tags

```typescript
// Single entity
@Cached({
  key: 'user:{0}',
  tags: (id: string) => [`user:${id}`],
})
async getUser(id: string) { }

// Collection
@Cached({
  key: 'users:list:{0}',
  tags: ['users:list'],
})
async listUsers(page: number) { }
```

### Hierarchical Tags

Use hierarchical tags when entities have parent-child relationships. This allows invalidating an entire subtree.

```typescript
// Cache user with org/team context
@Cached({
  key: 'user:{0}',
  tags: (id: string, orgId: string, teamId: string) => [
    `org:${orgId}`,
    `org:${orgId}:team:${teamId}`,
    `user:${id}`,
  ],
})
async getUser(id: string, orgId: string, teamId: string) { }

// Invalidate whole org — clears all users/teams in that org
@InvalidateTags({
  tags: (orgId: string) => [`org:${orgId}`],
  when: 'after',
})
async deleteOrganization(orgId: string) { }
```

## Configuration

Tag behavior is configured in plugin options:

```typescript
new CachePlugin({
  tags: {
    enabled: true,           // Enable/disable tag support (default: true)
    indexPrefix: '_tag:',    // Prefix for tag index keys in Redis (default: '_tag:')
    maxTagsPerKey: 10,       // Maximum tags per cache key (default: 10)
    ttl: 86400,              // TTL for tag index SETs in seconds (default: l2.maxTtl)
  },
})
```

::: warning Tag index TTL
Tag index SETs have their own TTL (default: 24 hours). If a tag SET expires before the cached keys it tracks, those keys become **orphans** — they won't be found by `invalidate()` or `getKeysByTag()`. Set `tags.ttl` >= your longest cache TTL.
:::

See [Configuration](./configuration) for the full options reference.

## Best Practices

### Do

```typescript
// Use specific + general tags
tags: ['users', 'user:123']

// Use hierarchical tags for subtree invalidation
tags: ['org:1', 'org:1:team:2', 'org:1:team:2:user:3']

// Keep tags short for high-volume caching
tags: ['u:123']
```

### Don't

```typescript
// Don't exceed max tags per key (default: 10, configurable)
// Exceeding throws CacheError, not silently truncated
tags: ['users', 'active', 'premium', 'verified', 'recent', ...]

// Don't put data in tags
tags: [`user:${JSON.stringify(user)}`]  // Never!

// Don't use unpredictable tags
tags: [`user:${Date.now()}`]  // Can't invalidate later

// Don't use uppercase (lowercased automatically, but be consistent)
tags: ['Users']  // Becomes 'users' — use 'users' directly
```

## Next Steps

- [Anti-Stampede](./stampede) — Prevent thundering herd
- [Stale-While-Revalidate](./swr) — Serve stale data while refreshing
- [Configuration](./configuration) — Full plugin options reference
