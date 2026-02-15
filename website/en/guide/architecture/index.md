---
title: Architecture
description: System design patterns for NestJS RedisX
---

# Architecture

This section covers system design decisions for Redis-based applications.

## For Developers

| Topic | Description |
|-------|-------------|
| [Key Naming](./key-naming) | Naming conventions and patterns |
| [Multi-Tenancy](./multi-tenancy) | Tenant isolation strategies |
| [Guarantees](./guarantees) | What is and isn't guaranteed |
| [Failure Modes](./failure-modes) | Graceful degradation patterns |
| [Connection Management](./connection-management) | Pools, timeouts, retries |

## For Operations

| Topic | Description |
|-------|-------------|
| [Deployment](./deployment) | Single vs Cluster vs Sentinel |
| [Tuning](./tuning) | Configuration profiles |
| [Security](./security) | TLS, ACL, data classification |

## Design Principles

### 1. Explicit Over Implicit

```typescript
// Explicit key naming
@Cached({ key: 'user:{0}:{1}' })

// Explicit TTL
@Cached({ ttl: 3600 })

// Explicit failure behavior  
@WithLock({ onLockFailed: 'throw' })
```

### 2. Sensible Defaults

All plugins work with zero configuration:

```typescript
// Works immediately
new CachePlugin()
new LocksPlugin()
new RateLimitPlugin()
```

### 3. Observable by Design

Every operation is traceable:

```typescript
// Automatic metrics
cache_hits_total{key_pattern="user:*"}

// Automatic tracing
cache.get user:123 [2ms, hit=true, layer=L1]
```

## Architecture Decision Records

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Cache library | Custom L1 + ioredis | Full control, two-tier support |
| Lock algorithm | Single-node Redlock | Simpler, sufficient for most cases |
| Rate limit storage | Redis sorted sets | Efficient sliding window |
| Serialization | JSON (default) | Human-readable, debuggable |

## Next Steps

Start with the topic most relevant to your design:

- Designing key structure? → [Key Naming](./key-naming)
- Multi-tenant SaaS? → [Multi-Tenancy](./multi-tenancy)
- Need formal guarantees? → [Guarantees](./guarantees)
- Handling failures? → [Failure Modes](./failure-modes)
