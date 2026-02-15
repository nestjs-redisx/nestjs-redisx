---
title: Patterns
description: Common distributed lock patterns
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

## 7. Timeout Pattern

Wait for lock with timeout:

```typescript
@WithLock({
  key: 'resource:{0}',
  waitTimeout: 5000,  // Wait max 5 seconds
})
async accessResource(id: string) {
  // Uses global retry settings
  // Throws LockAcquisitionError if cannot acquire within timeout
}
```

## Next Steps

- [Monitoring](./monitoring) — Track lock performance
- [Recipes](./recipes) — Real-world examples
