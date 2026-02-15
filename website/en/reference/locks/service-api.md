---
title: Service API
description: Programmatic lock management with LockService
---

# Service API

Direct lock manipulation when decorators aren't enough.

## Inject LockService

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { LOCK_SERVICE, ILockService } from '@nestjs-redisx/locks';

@Injectable()
export class InventoryService {
  constructor(
    @Inject(LOCK_SERVICE) private readonly lockService: ILockService,
  ) {}
}
```

## Basic Operations

### Acquire

```typescript
const lock = await this.lockService.acquire('inventory:sku-123', {
  ttl: 10000,
  retry: { maxRetries: 3 },
});

try {
  // Critical section
  await this.updateInventory();
} finally {
  await lock.release();
}
```

### Try Acquire (Non-Blocking)

```typescript
const lock = await this.lockService.tryAcquire('resource:123');

if (lock) {
  try {
    // Got lock
    await this.doWork();
  } finally {
    await lock.release();
  }
} else {
  // Lock not available
  throw new ConflictException('Resource busy');
}
```

### With Lock (Auto-Release)

```typescript
const result = await this.lockService.withLock(
  'payment:order-123',
  async () => {
    // Lock acquired
    const payment = await this.processPayment();
    return payment;
    // Lock auto-released
  },
  { ttl: 30000 }
);
```

### Check if Locked

```typescript
const busy = await this.lockService.isLocked('order:123');

if (busy) {
  console.log('Order is currently being processed');
}
```

### Force Release (Admin)

```typescript
// Emergency: remove a stuck lock regardless of ownership
// Use with extreme caution — can break critical sections
const removed = await this.lockService.forceRelease('stuck:lock');

if (removed) {
  console.log('Lock was force-released');
}
```

## Lock Entity

```typescript
interface ILock {
  readonly key: string;
  readonly token: string;
  readonly ttl: number;
  readonly acquiredAt: Date;
  readonly expiresAt: Date;
  readonly isAutoRenewing: boolean;

  // Methods
  release(): Promise<void>;
  extend(ttl: number): Promise<void>;
  isHeld(): Promise<boolean>;
  stopAutoRenew(): void;
}
```

### Extend Lock

```typescript
const lock = await this.lockService.acquire('long:task');

// ... work ...

// Need more time
await lock.extend(30000);  // Add 30 more seconds
```

### Check Lock Status

```typescript
if (!(await lock.isHeld())) {
  console.warn('Lock lost during operation!');
}
```

## Advanced Patterns

### Conditional Locking

```typescript
async processIfNotLocked(orderId: string): Promise<boolean> {
  const lock = await this.lockService.tryAcquire(`order:${orderId}`);
  
  if (!lock) {
    return false;  // Already being processed
  }
  
  try {
    await this.process(orderId);
    return true;
  } finally {
    await lock.release();
  }
}
```

### Multi-Resource Locking

```typescript
async transferInventory(fromSku: string, toSku: string, qty: number) {
  // Lock both resources in consistent order to avoid deadlock
  const keys = [fromSku, toSku].sort();
  
  const lock1 = await this.lockService.acquire(`inventory:${keys[0]}`);
  try {
    const lock2 = await this.lockService.acquire(`inventory:${keys[1]}`);
    try {
      await this.decrement(fromSku, qty);
      await this.increment(toSku, qty);
    } finally {
      await lock2.release();
    }
  } finally {
    await lock1.release();
  }
}
```

### Graceful Degradation

```typescript
async criticalOperation(id: string) {
  let lock: ILock | null = null;
  
  try {
    lock = await this.lockService.acquire(`critical:${id}`, {
      ttl: 10000,
      retry: { maxRetries: 2 },
    });
  } catch (error) {
    // Couldn't get lock - decide how to handle
    if (this.isHighPriority) {
      throw error;  // Fail
    } else {
      return this.queueForLater(id);  // Defer
    }
  }
  
  try {
    return await this.execute(id);
  } finally {
    if (lock) {
      await lock.release();
    }
  }
}
```

## Error Handling

```typescript
import {
  LockAcquisitionError,
  LockNotOwnedError,
  LockExtensionError,
} from '@nestjs-redisx/locks';

try {
  const lock = await this.lockService.acquire('resource');
  try {
    await this.doWork();
  } finally {
    await lock.release();
  }
} catch (error) {
  if (error instanceof LockAcquisitionError) {
    // Could not acquire lock after all retries
    console.error('Lock busy:', error.lockKey, error.reason);
  } else if (error instanceof LockNotOwnedError) {
    // Tried to release a lock not owned by this token
    console.error('Token mismatch:', error.token);
  } else if (error instanceof LockExtensionError) {
    // Failed to extend lock TTL
    console.error('Extension failed:', error.lockKey);
  }
}
```

## Next Steps

- [Auto-Renewal](./auto-renewal) — Automatic lock extension
- [Retry Strategies](./retry-strategies) — Configuring retries
