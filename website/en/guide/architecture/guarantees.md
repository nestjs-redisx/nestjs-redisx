---
title: Guarantees
description: Formal semantics and guarantees of NestJS RedisX
---

# Guarantees

This page formally specifies what NestJS RedisX guarantees and what it does not.

## Definitions

| Term | Definition |
|------|------------|
| **At-least-once** | Operation may execute multiple times; will execute at least once |
| **At-most-once** | Operation executes zero or one time; never more |
| **Lease** | Time-bounded exclusive access to a resource |
| **Ownership token** | Unique identifier proving lock ownership |
| **Stale** | Data that may not reflect the latest write |

## Cache Guarantees

### What IS Guaranteed

| Guarantee | Description |
|-----------|-------------|
| Read-your-writes | Same process sees its own writes immediately |
| Bounded staleness | Data is at most TTL seconds old |
| Atomic operations | Individual get/set/delete are atomic |

### What is NOT Guaranteed

| Not Guaranteed | Explanation |
|----------------|-------------|
| Cross-instance consistency | Other instances may see stale data until L1 invalidation propagates |
| Persistence | Cache data may be lost on Redis restart (unless AOF enabled) |
| Ordering | Concurrent writes have undefined order |

### Consistency Model

```
Write to Instance A
    ↓ (immediate)
L1 Cache on A updated
    ↓ (immediate)
L2 Redis updated
    ↓ (pub/sub, ~1-10ms)
L1 Cache on B invalidated
```

**Staleness window:** 1-10ms for L1 pub/sub propagation

## Lock Guarantees

### What IS Guaranteed

| Guarantee | Condition | Description |
|-----------|-----------|-------------|
| Mutual exclusion | Normal network, live lease | Only one holder at a time while TTL is valid or auto-renewal keeps it alive |
| Ownership verification | Always | Only owner can release or extend (Lua-atomic token check) |
| Deadlock freedom | Always | TTL ensures every lock eventually expires |

### What is NOT Guaranteed

| Not Guaranteed | Explanation | What to Use Instead |
|----------------|-------------|---------------------|
| Consensus-level safety | Single-Redis lock, not Raft/Paxos. Network partition or Redis failover can violate mutual exclusion | ZooKeeper/etcd for true consensus |
| Fencing semantics | No monotonic token for downstream verification. Stale holder can still write after TTL expires | DB constraints + idempotency |
| Exactly-once execution | Crash mid-operation leaves partial state. Lock serializes, doesn't make operations atomic | Idempotency plugin + DB constraints |
| Fairness | No FIFO ordering of waiters | Application-level queuing |

### Lock Semantics

```
Acquire(key, ttl):
  IF key not exists:
    SET key = token, EX = ttl
    RETURN token
  ELSE:
    RETURN null (or wait)

Release(key, token):
  IF GET(key) == token:
    DELETE key
  ELSE:
    NO-OP (lost ownership)
```

### Defense-in-Depth for Critical Operations

Locks alone are not enough for payments, financial writes, or any operation where partial execution has consequences:

| Layer | Protects Against | Alone Sufficient? |
|-------|-----------------|--------------------|
| Lock | Concurrent execution | No — TTL expiry, Redis failover |
| Idempotency | Duplicate requests | No — doesn't prevent concurrent first attempts |
| DB constraint (UNIQUE) | Everything above | Yes, but poor UX |
| **All three combined** | **Most real-world failure modes** | **Yes** |

::: warning Idempotency key must be business-meaningful
Use a stable business identifier (`orderId`, `paymentIntentId`, `requestId`) — not a random hash or UUID generated per request. A random key defeats the purpose: every retry looks like a new operation.
:::

::: tip Rule of thumb
If losing the lock mid-operation would cost money or corrupt data — add `@Idempotent` + DB constraints. If it would just cause a retry — lock alone is fine. See [Locks → Concepts](../../reference/locks/concepts#what-to-do-for-payments-db-writes-and-critical-paths) for code example.
:::

## Idempotency Guarantees

### What IS Guaranteed

| Guarantee | Description |
|-----------|-------------|
| Duplicate detection (within TTL) | Same idempotency key returns cached response |
| Response replay | Exact same response for duplicate requests |
| Concurrent request handling | One executes, others wait and get same result |

### What is NOT Guaranteed

| Not Guaranteed | Explanation |
|----------------|-------------|
| Exactly-once execution | First request may execute partially before failure |
| Detection after TTL | Duplicates after TTL expiration are processed again |
| Cross-service detection | Idempotency is per-service unless sharing Redis |

### Idempotency State Machine

```
New Request:
  ├─ Key not found → Execute, store response, return
  ├─ Key found (processing) → Wait, return cached response
  └─ Key found (completed) → Return cached response immediately
```

## Rate Limit Guarantees

### What IS Guaranteed

| Guarantee | Description |
|-----------|-------------|
| Approximate rate enforcement | Requests exceeding limit are rejected |
| Distributed counting | Counts are shared across instances |
| Sliding window accuracy | More accurate than fixed window |

### What is NOT Guaranteed

| Not Guaranteed | Explanation |
|----------------|-------------|
| Exact limit enforcement | Distributed systems have inherent race conditions |
| Fairness | No guaranteed fair distribution among clients |
| Real-time accuracy | 5-10% variance is normal |

### Accuracy Expectations

```
Configured limit: 100 req/min
Actual enforcement: 95-105 req/min (±5%)

Under high concurrency: 90-110 req/min (±10%)
```

## Streams Guarantees

### What IS Guaranteed

| Guarantee | Description |
|-----------|-------------|
| At-least-once delivery | Messages delivered at least once per consumer group |
| Ordering | Messages ordered within a single stream |
| Persistence | Messages persist until trimmed |
| Consumer groups | Each message to one consumer per group |

### What is NOT Guaranteed

| Not Guaranteed | Explanation |
|----------------|-------------|
| Exactly-once delivery | Consumer may receive same message twice |
| Cross-stream ordering | No ordering between different streams |
| Delivery timing | Backpressure may delay delivery |

## Failure Matrix

| Scenario | Cache | Locks | Idempotency | Rate Limit | Streams |
|----------|-------|-------|-------------|------------|---------|
| Redis down | Configurable (allow/deny) | Fail closed | Configurable | Configurable | Fail closed |
| Network partition | Stale reads possible | Split brain risk | May duplicate | Over-limit possible | Consumer lag |
| Process crash | Data intact | Auto-release via TTL | Data intact | Data intact | Redelivery |
| Redis restart | Data lost (no AOF) | Locks lost | Data lost | Counters reset | Data lost (no AOF) |

## Configuration for Safety Levels

### Maximum Safety

```typescript
// Cache: Fail if Redis down
new CachePlugin({
  fallback: 'throw',
})

// Locks: No auto-renewal, verify ownership
new LocksPlugin({
  autoRenew: { enabled: false },
  verifyOwnership: true,
})

// Idempotency: Fail if can't check
new IdempotencyPlugin({
  fallback: 'throw',
})
```

### Maximum Availability

```typescript
// Cache: Allow on failure
new CachePlugin({
  fallback: 'bypass',
})

// Locks: Auto-renew, short retry
new LocksPlugin({
  autoRenew: { enabled: true },
  retry: { maxRetries: 1 },
})

// Idempotency: Process anyway
new IdempotencyPlugin({
  fallback: 'allow',
})
```

## Approximating Exactly-Once

True exactly-once is impossible in distributed systems. Approximate it with:

```typescript
// 1. Idempotency for duplicate detection
@Idempotent()

// 2. Lock for serialization
@WithLock({ key: 'resource:{0}' })

// 3. Database constraint for final safety
// UNIQUE INDEX on idempotency_key

// 4. Idempotent handlers
async process(id: string) {
  // Check if already processed
  if (await this.isProcessed(id)) return;
  
  // Process
  await this.doWork(id);
  
  // Mark processed (idempotent write)
  await this.markProcessed(id);
}
```

## Next Steps

- [Failure Modes](./failure-modes) — Handling failures gracefully
- [Distributed Coordination](../concepts/distributed-coordination) — Choosing mechanisms
