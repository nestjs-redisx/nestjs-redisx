---
title: Service API
description: Programmatic cache access with CacheService
---

# Service API

Direct cache manipulation when decorators aren't enough.

## Inject CacheService

```typescript
import { Injectable } from '@nestjs/common';
import { CacheService } from '@nestjs-redisx/cache';

@Injectable()
export class UserService {
  constructor(private readonly cache: CacheService) {}
}
```

Or by token (useful for mocking in tests):

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { CACHE_SERVICE, type ICacheService } from '@nestjs-redisx/cache';

@Injectable()
export class UserService {
  constructor(@Inject(CACHE_SERVICE) private readonly cache: ICacheService) {}
}
```

## Basic Operations

### Get

```typescript
const user = await this.cache.get<User>('user:123');
// Returns: User | null
```

### Set

```typescript
// Simple set
await this.cache.set('user:123', user);

// With options
await this.cache.set('user:123', user, {
  ttl: 300,
  tags: ['users', 'user:123'],
  strategy: 'l1-l2',  // 'l1-only' | 'l2-only' | 'l1-l2' (default)
  varyBy: { tenantId: 'acme' },  // Additional key variation (multi-tenant)
});
```

::: info varyBy in Service API vs decorators
In Service API, `varyBy` accepts **resolved key-value pairs** (`Record<string, string>`) — you provide the values directly.
In `@Cached` decorator, `varyBy` accepts **key names** (`string[]`) — values are resolved automatically from `contextProvider`.
:::

### Get or Set (Cache-Aside)

Atomically get from cache or load and cache if missing. Includes anti-stampede protection.

```typescript
const user = await this.cache.getOrSet<User>(
  'user:123',
  () => this.repository.findOne('123'),
  { ttl: 300, tags: ['users'] }
);
```

Full options (inherits all `set()` options plus SWR and stampede control):

```typescript
const user = await this.cache.getOrSet<User>(
  'user:123',
  () => this.repository.findOne('123'),
  {
    ttl: 300,
    tags: ['users'],
    strategy: 'l1-l2',                      // 'l1-only' | 'l2-only' | 'l1-l2'
    varyBy: { tenantId: 'acme' },           // Additional key variation
    swr: { enabled: true, staleTime: 60 },  // Stale-while-revalidate
    skipStampede: true,                      // Bypass anti-stampede for this call
  }
);
```

### Delete

```typescript
// Single key
const deleted = await this.cache.del('user:123');
// Returns: boolean

// Multiple keys
const count = await this.cache.deleteMany(['user:123', 'user:456']);
// Returns: number (count of deleted keys)
```

### Has

```typescript
const exists = await this.cache.has('user:123');
// Returns: boolean
```

### TTL

```typescript
const ttl = await this.cache.ttl('user:123');
// Returns: number (seconds), -1 if no TTL, -2 if key doesn't exist
```

## Batch Operations

### Batch Get

```typescript
const users = await this.cache.getMany<User>([
  'user:1',
  'user:2',
  'user:3',
]);
// Returns: Array<User | null>
```

### Batch Set

```typescript
await this.cache.setMany([
  { key: 'user:1', value: user1, ttl: 3600, tags: ['users'] },
  { key: 'user:2', value: user2, ttl: 3600, tags: ['users'] },
  { key: 'user:3', value: user3, ttl: 3600, tags: ['users'] },
]);
```

::: info
`setMany` accepts `key`, `value`, `ttl`, and `tags` per entry. For `strategy` per entry, use individual `set()` calls.
:::

## Tag Operations

### Get Keys by Tag

```typescript
const keys = await this.cache.getKeysByTag('users');
// Returns: string[]
```

### Invalidate by Tag

```typescript
// Single tag
const count = await this.cache.invalidate('users');
// Returns: number (count of invalidated keys)

// Multiple tags
const count = await this.cache.invalidateTags(['users', 'products']);
// Returns: number (total keys invalidated)
```

### Invalidate by Pattern

```typescript
// Delete all keys matching pattern (uses Redis SCAN)
const count = await this.cache.invalidateByPattern('user:*');
// Returns: number (count of deleted keys)
```

## Wrap Function

Wrap any function with caching logic. Uses `getOrSet` internally (includes anti-stampede).

<<< @/apps/demo/src/plugins/cache/service-get-or-set.usage.ts{typescript}

## Clear All

```typescript
// Use with caution in production
await this.cache.clear();
```

## Statistics

```typescript
const stats = await this.cache.getStats();

/*
{
  l1: {
    hits: 15234,
    misses: 1876,
    size: 523,
  },
  l2: {
    hits: 45123,
    misses: 2341,
  },
  stampedePrevented: 142,
}
*/
```

## Error Handling

**Read operations** (`get`, `has`, `ttl`, `getMany`, `getKeysByTag`) are **fail-open** — errors return `null`/`false`/`[]`.

**Write operations** (`set`, `del`, `deleteMany`, `setMany`, `getOrSet`, `invalidate`, `clear`) are **fail-closed** — errors throw.

| Scenario | Behavior |
|----------|----------|
| Redis error on `get` / `has` / `ttl` | **Fail-open.** Returns `null` / `false` / `-1`. Error logged. |
| Redis error on `set` / `del` / `clear` | **Fail-closed.** Throws `CacheError`. |
| Key validation fails on `get` / `has` / `ttl` | **Fail-open.** Returns `null` / `false` / `-1`. Warning logged. |
| Key validation fails on `set` / `del` / `getOrSet` | **Fail-closed.** Throws `CacheKeyError`. |
| Loader throws in `getOrSet` | Error propagates. Cache is not updated. |
| `invalidate` / `invalidateTags` fails | **Fail-closed.** Throws `CacheError`. |
| `invalidateByPattern` fails | **Fail-closed.** Throws `CacheError`. |

Key validation rules: non-empty, no whitespace, only `a-zA-Z0-9_-:.`, max 1024 chars (configurable via `keys.maxLength`).

## Next Steps

- [Tag Invalidation](./tags) — Advanced tag patterns
- [Anti-Stampede](./stampede) — Prevent cache stampede
