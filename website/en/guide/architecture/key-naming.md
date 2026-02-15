---
title: Key Naming
description: Redis key naming conventions and patterns
---

# Key Naming

Consistent key naming prevents conflicts, enables monitoring, and simplifies debugging.

## Recommended Structure

```
{service}:{tenant}:{entity}:{id}:{variant}
```

| Component | Required | Example | Purpose |
|-----------|----------|---------|---------|
| service | Yes | `api`, `worker` | Namespace by service |
| tenant | If multi-tenant | `tenant-123` | Tenant isolation |
| entity | Yes | `user`, `order` | Data type |
| id | Yes | `456`, `abc-def` | Unique identifier |
| variant | Optional | `profile`, `v2` | Sub-resource or version |

## Examples

```
# Single-tenant application
cache:user:123
cache:user:123:profile
cache:order:456
lock:payment:order-789
ratelimit:ip:192.168.1.1

# Multi-tenant SaaS
cache:acme:user:123
cache:acme:user:123:profile
lock:acme:payment:order-789
ratelimit:acme:api:user-456

# Microservices
api:cache:user:123
worker:lock:job:batch-789
auth:ratelimit:login:user-456
```

## Automatic Key Generation

RedisX generates keys from decorator parameters:

```typescript
// Key: cache:user:123
@Cached({ key: 'user:{0}' })
async getUser(id: string) {}

// Key: cache:tenant-abc:user:123
@Cached({ key: '{0}:user:{1}' })
async getUser(tenantId: string, id: string) {}

// Key: lock:order:456
@WithLock({ key: 'order:{0}' })
async processOrder(orderId: string) {}
```

## Plugin Prefixes

Each plugin uses a default prefix:

| Plugin | Default Prefix | Full Key Example |
|--------|----------------|------------------|
| Cache | `cache:` | `cache:user:123` |
| Locks | `lock:` | `lock:payment:456` |
| Rate Limit | `ratelimit:` | `ratelimit:ip:1.2.3.4` |
| Idempotency | `idempotency:` | `idempotency:abc-123` |
| Streams | (stream name) | `orders` |

Customize prefixes in configuration:

```typescript
new CachePlugin({
  keyPrefix: 'myapp:cache:',
})
```

## Key Design Rules

### DO

```typescript
// Use colons as separators
'user:123:profile'

// Use lowercase
'order:abc-123'

// Include context
'tenant-a:user:123'

// Use consistent order
'{service}:{tenant}:{entity}:{id}'
```

### DON'T

```typescript
// Spaces or special characters
'user profile:123'  // Bad

// Inconsistent separators
'user-123_profile'  // Bad

// Missing context
'123'  // Bad - what is this?

// PII in keys
'user:john.doe@email.com'  // Bad - use IDs
```

## Key Length Considerations

| Key Length | Impact |
|------------|--------|
| < 100 bytes | Optimal |
| 100-500 bytes | Acceptable |
| > 500 bytes | Consider hashing |

```typescript
// Long key? Hash it
import { createHash } from 'crypto';

function hashKey(parts: string[]): string {
  const full = parts.join(':');
  if (full.length > 100) {
    const hash = createHash('sha256').update(full).digest('hex').slice(0, 16);
    return `${parts[0]}:${parts[1]}:${hash}`;
  }
  return full;
}
```

## Pattern Matching

Design keys for efficient pattern operations:

```typescript
// Find all user cache entries
KEYS 'cache:user:*'

// Find all entries for a tenant
KEYS 'cache:tenant-abc:*'

// Find all locks for payments
KEYS 'lock:payment:*'
```

::: warning KEYS Command
Avoid `KEYS` in production. Use `SCAN` instead:

```typescript
// Production-safe pattern matching
const keys = await scanKeys(redis, 'cache:user:*');
```
:::

## Monitoring by Pattern

Key patterns enable aggregated metrics:

```yaml
# Cache hit rate by entity type
sum(rate(cache_hits_total{key=~"cache:user:.*"}[5m])) 
/ sum(rate(cache_requests_total{key=~"cache:user:.*"}[5m]))

# Lock contention by resource type
sum(rate(lock_timeouts_total{key=~"lock:payment:.*"}[5m]))
```

## Migration Strategy

When changing key structure:

```typescript
// 1. Write to both old and new
@Cached({ key: ['user:{0}', 'v2:user:{0}'] })

// 2. Read from new, fallback to old
// (handled automatically)

// 3. After migration, remove old pattern
@Cached({ key: 'v2:user:{0}' })
```

## Next Steps

- [Multi-Tenancy](./multi-tenancy) — Tenant-specific key patterns
- [Security](./security) — Key injection prevention
