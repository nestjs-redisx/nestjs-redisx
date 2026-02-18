---
title: Cache Issues
description: Troubleshoot common cache problems
---

# Cache Issues

Solutions for common cache problems.

## Problem: Cache Not Working

### Symptoms
- Always hitting database
- Cache hit rate is 0%
- `@Cached` decorator not caching

### Diagnosis

```bash
# Check if keys exist
redis-cli KEYS "cache:*"

# Check specific key
redis-cli GET "cache:user:123"

# Check TTL
redis-cli TTL "cache:user:123"
```

### Solutions

| Cause | Solution |
|-------|----------|
| Plugin not registered | Add `CachePlugin` to `plugins` array |
| Wrong key pattern | Check key template matches arguments |
| TTL = 0 | Set positive TTL value |
| Redis not connected | Check connection settings |

::: code-group
```typescript [Correct]
// @Cached uses positional placeholders: {0}, {1}, etc.
@Cached({ key: 'user:{0}', ttl: 3600 })
async getUser(id: string) { }
```

```typescript [Wrong]
// Named placeholders like {userId} are not resolved by @Cached
@Cached({ key: 'user:{userId}', ttl: 3600 })
async getUser(id: string) { }
```
:::

---

## Problem: Stale Data

### Symptoms
- Updated data not appearing
- Old values returned after update
- Inconsistency between instances

### Diagnosis

```bash
# Check when key was set
redis-cli OBJECT IDLETIME "cache:user:123"

# Check TTL remaining
redis-cli TTL "cache:user:123"
```

### Solutions

| Cause | Solution |
|-------|----------|
| No invalidation | Add `@CacheEvict` on updates |
| Wrong invalidation key | Verify key matches cached key |
| L1 not invalidated | Enable pub/sub for L1 sync |
| Tags not matching | Check tag names match |

```typescript
// Cache
@Cached({
  key: 'user:{0}',
  tags: (id) => ['users', `user:${id}`],
})
async getUser(id: string) { }

// Invalidate - tags must match!
async updateUser(id: string, data: any) {
  await this.userRepository.update(id, data);
  await this.cache.invalidateTags([`user:${id}`, 'users']);
}
```

---

## Problem: Low Hit Rate

### Symptoms
- Hit rate below 80%
- High database load
- Cache seems ineffective

### Diagnosis

```yaml
# Check hit rate
sum(rate(redisx_cache_hits_total[5m])) / 
(sum(rate(redisx_cache_hits_total[5m])) + sum(rate(redisx_cache_misses_total[5m])))
```

### Solutions

| Cause | Solution |
|-------|----------|
| TTL too short | Increase TTL |
| Key too specific | Generalize key pattern |
| Low repeat requests | Consider if caching is appropriate |
| Cache evictions | Increase Redis memory |

::: code-group
```typescript [Correct]
// Reusable across requests
@Cached({ key: 'search:{0}', ttl: 60 })
```

```typescript [Wrong]
// Too specific - every request is unique
@Cached({ key: 'search:{0}:{1}', ttl: 60 })
```
:::

---

## Problem: Cache Stampede

### Symptoms
- Database overwhelmed on cache miss
- Multiple identical queries simultaneously
- Spike after cache expiration

### Solutions

Stampede protection is enabled by default for both `@Cached` and `getOrSet()`. No extra configuration needed on the decorator — it's controlled at the plugin level:

```typescript
new CachePlugin({
  stampede: {
    enabled: true,       // default: true
    lockTimeout: 5000,   // default: 5000ms
    waitTimeout: 10000,  // default: 10000ms
  },
})
```

```typescript
// Stampede protection is automatic
@Cached({ key: 'popular:item', ttl: 300 })
async getPopularItem() { }
```

Combine with stale-while-revalidate for even better protection:

```typescript
@Cached({
  key: 'dashboard',
  ttl: 60,
  swr: { enabled: true, staleTime: 300 }, // Serve stale for 5 min while refreshing
})
async getDashboard() { }
```

---

## Problem: Memory Issues

### Symptoms
- Redis memory maxed out
- Evictions increasing
- OOM errors

### Diagnosis

```bash
# Check memory usage
redis-cli INFO memory

# Check eviction policy
redis-cli CONFIG GET maxmemory-policy

# Find large keys
redis-cli --bigkeys
```

### Solutions

| Cause | Solution |
|-------|----------|
| TTL too long | Reduce TTL |
| Large values | Compress or reduce data |
| Too many keys | Increase memory or reduce cardinality |
| No eviction policy | Set `maxmemory-policy` to `allkeys-lru` |

---

## Problem: Tags Not Invalidating

### Symptoms
- `invalidateTags` called but data not cleared
- Some keys cleared, others not
- Tag invalidation slow

### Diagnosis

```bash
# Check tag index
redis-cli SMEMBERS "tag:users"

# Check if key has tag
redis-cli GET "cache:user:123"
```

### Solutions

| Cause | Solution |
|-------|----------|
| Tag name mismatch | Verify exact tag names |
| Tags not indexed | Ensure tags were set on cache |
| Pub/sub not working | Check Redis pub/sub |

```typescript
// Setting tags — use function form for dynamic values
@Cached({
  key: 'user:{0}',
  tags: (id) => ['users', `user:${id}`],
})
async getUser(id: string) { }

// Invalidating — tags must match exactly
await cache.invalidateTags(['users']);  // Clears all users
await cache.invalidateTags(['user:123']);  // Clears specific user
```

## Next Steps

- [Lock Issues](./lock-issues) — Lock troubleshooting
- [Debugging](./debugging) — Debugging techniques
