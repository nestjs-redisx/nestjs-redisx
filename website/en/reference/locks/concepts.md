---
title: Core Concepts
description: Understanding distributed locks, tokens, TTL, and lock safety
---

# Core Concepts

Understanding how distributed locks work and why they're safe.

## What is a Distributed Lock?

A distributed lock coordinates access to a shared resource across multiple processes or servers.

### Lock Key

Identifies the resource being locked:

```
_lock:payment:order-123
  |      |       |
  |      |       +-- Resource identifier
  |      +-- Resource type  
  +-- Prefix (configurable)
```

```typescript
// Examples of lock keys
'payment:order-123'      // Specific order
'inventory:sku-abc'      // Specific item
'user:123:profile'       // User profile
'report:daily:2025-01'   // Daily report
'sync:products'          // Global sync
```

### Lock Token

Unique identifier proving lock ownership:

```typescript
// Token format: pid-timestamp-random
'12345-1706123456789-k7x9m2p'
   |          |          |
   |          |          +-- Random string
   |          +-- Timestamp (ms)
   +-- Process ID
```

**Why tokens matter:** They prevent accidental release by another process.

### Lock TTL

Time-To-Live prevents deadlocks:

| TTL | Use Case | Risk |
|-----|----------|------|
| 5s | Quick operations | Low risk |
| 30s | Standard operations | Default |
| 5min | Long operations | Use auto-renew |
| >10min | Very long tasks | Must use auto-renew |

## Lock Safety Properties

### 1. Mutual Exclusion

Only one client holds the lock at a time:

```lua
-- Redis SET with NX (only if Not eXists)
SET lock:resource token NX PX 30000
```

### 2. Deadlock Freedom

TTL ensures locks are eventually released.

### 3. Fault Tolerance

Token verification prevents accidental release:

```lua
-- Release only if we own it
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0  -- Not our lock!
end
```

## Lock vs Mutex vs Semaphore

| Concept | Description | NestJS RedisX |
|---------|-------------|---------------|
| **Mutex** | Binary lock, one holder | `@WithLock` |
| **Semaphore** | N concurrent holders | Manual (counter) |
| **Read-Write Lock** | Many readers OR one writer | Manual |
| **Reentrant Lock** | Same holder can re-acquire | Not supported |

## Redis Data Model

```
+-------------------------------------------------------------+
| Redis                                                       |
+-------------------------------------------------------------+
| Key                        | Value          | TTL           |
+-------------------------------------------------------------+
| _lock:payment:order-123    | 12345-abc-xyz  | 30000ms       |
| _lock:inventory:sku-001    | 67890-def-uvw  | 5000ms        |
| _lock:sync:products        | 11111-ghi-rst  | 60000ms       |
+-------------------------------------------------------------+
```

## Guarantees and Limitations

### Guaranteed

| Property | Description |
|----------|-------------|
| Atomicity | Acquire/release are atomic (Lua) |
| Exclusivity | Single holder at any time |
| Auto-expiry | TTL prevents permanent locks |
| Safe release | Token verification |

### Not Guaranteed

| Limitation | Reason | Mitigation |
|------------|--------|------------|
| Clock synchronization | Different server clocks | Use reasonable TTL margins |
| Split-brain | Network partition | Use Redis Cluster or Sentinel |
| Exactly-once | Process may die after work | Implement idempotency |

## What Locks Guarantee and What They Don't

### Guaranteed (normal network, live lease)

- **Mutual exclusion while TTL is valid** — if your operation completes within TTL (or auto-renewal keeps it alive), no other process holds the lock
- **Ownership verification** — only the holder can release or extend (Lua-atomic token check)
- **Deadlock freedom** — TTL ensures every lock eventually expires

### NOT Guaranteed

- **Consensus-level safety** — this is a single-Redis lock, not Raft/Paxos. Network partition or Redis failover can violate mutual exclusion
- **Fencing semantics** — no monotonic token that downstream can verify. If your process holds a stale lock (TTL expired, then re-acquired by another), nothing prevents the stale holder from writing
- **Exactly-once execution** — a crash mid-operation leaves partial state. Lock only serializes access, it doesn't make operations atomic

### What to Do for Payments, DB Writes, and Critical Paths

Locks alone are **not enough** for financial operations. Use defense-in-depth:

```typescript
// Layer 1: Idempotency — detect duplicate requests
@Idempotent({ key: 'payment:{orderId}' })

// Layer 2: Lock — serialize concurrent attempts
@WithLock({ key: 'order:{orderId}', ttl: 30 })

async processPayment(orderId: string) {
  // Layer 3: DB constraint — final safety net
  // INSERT ... ON CONFLICT (idempotency_key) DO NOTHING
  await this.db.insertPayment({
    orderId,
    idempotencyKey: this.idempotencyKey,
  });
}
```

| Layer | Protects Against | Alone Sufficient? |
|-------|-----------------|--------------------|
| Lock | Concurrent execution | No — TTL expiry, Redis failover |
| Idempotency | Duplicate requests | No — doesn't prevent concurrent first attempts |
| DB constraint | Everything above | Yes, but poor UX (errors instead of dedup) |
| **All three** | **Most real-world failure modes** | **Yes** |

::: warning Idempotency key must be business-meaningful
Use a stable business identifier (`orderId`, `paymentIntentId`, `requestId`) — not a random hash or UUID generated per request. A random key defeats the purpose: every retry looks like a new operation.
:::

::: tip Rule of thumb
If losing the lock mid-operation would cost money or corrupt data — add idempotency + DB constraints. If it would just cause a retry or a slow response — lock alone is fine.
:::

## Next Steps

- [Configuration](./configuration) — Full configuration reference
- [Decorator](./decorator) — Learn @WithLock decorator
