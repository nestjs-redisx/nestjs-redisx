---
title: 'Lock Patterns — Locks Plugin | NestJS RedisX'
description: 'Implement mutex, leader election, resource pool, and distributed semaphore patterns with @WithLock and LockService in NestJS Redis apps.'
---

# Patterns

Common patterns for using distributed locks.

## 1. Mutex Pattern

Basic mutual exclusion:

```typescript
@WithLock({ key: 'payment:{0}' })
async processPayment(orderId: string) {
  // Only one instance processes this order
}
```

## 2. Leader Election

Elect a single leader among multiple instances:

<<< @/apps/demo/src/plugins/locks/pattern-leader.usage.ts{typescript}

## 3. Resource Pool

Manage limited resources:

<<< @/apps/demo/src/plugins/locks/pattern-resource-pool.usage.ts{typescript}

## 4. Distributed Semaphore

Allow N concurrent holders:

```typescript
async acquireSemaphore(key: string, maxConcurrent: number): Promise<boolean> {
  const count = await this.redis.incr(`semaphore:${key}`);
  
  if (count > maxConcurrent) {
    await this.redis.decr(`semaphore:${key}`);
    return false;
  }
  
  return true;
}

async releaseSemaphore(key: string) {
  await this.redis.decr(`semaphore:${key}`);
}
```

## 5. Lock Hierarchy

Prevent deadlocks with ordered locking:

```typescript
async transferFunds(fromAccount: string, toAccount: string, amount: number) {
  // Always lock in alphabetical order
  const [first, second] = [fromAccount, toAccount].sort();
  
  const lock1 = await this.lockService.acquire(`account:${first}`);
  try {
    const lock2 = await this.lockService.acquire(`account:${second}`);
    try {
      await this.debit(fromAccount, amount);
      await this.credit(toAccount, amount);
    } finally {
      await lock2.release();
    }
  } finally {
    await lock1.release();
  }
}
```

## 6. Try-Lock Pattern

Non-blocking acquisition:

```typescript
async tryProcessOrder(orderId: string): Promise<boolean> {
  const lock = await this.lockService.tryAcquire(`order:${orderId}`);
  
  if (!lock) {
    // Order already being processed
    return false;
  }
  
  try {
    await this.process(orderId);
    return true;
  } finally {
    await lock.release();
  }
}
```

## 7. Bounded-Wait Pattern

Bound how long acquisition waits before giving up. There is **no `waitTimeout`**
— acquisition waiting is governed entirely by the retry config (`maxRetries`
with exponential backoff). Tune those globally on the plugin to set the
effective wait budget:

```typescript
// Effective max wait ≈ sum of backoff delays across retries
new LocksPlugin({
  retry: {
    maxRetries: 5,
    initialDelay: 100,
    multiplier: 2,
    maxDelay: 2000,
  },
})

// @WithLock then waits across those retries before throwing
@WithLock({ key: 'resource:{0}' })
async accessResource(id: string) {
  // Throws LockAcquisitionError once retries are exhausted
}
```

::: warning
`waitTimeout` is accepted by the decorator/service options but is **ignored** —
do not use it to bound wait time. Use the retry settings above instead.
:::

## Next Steps

- [Monitoring](./monitoring) — Track lock performance
- [Recipes](./recipes) — Real-world examples
