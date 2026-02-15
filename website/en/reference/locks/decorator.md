---
title: "@WithLock Decorator"
description: Declarative distributed locking with method decorators
---

# @WithLock Decorator

Declarative locking — add distributed locks with a single decorator.

## Basic Usage

<<< @/apps/demo/src/plugins/locks/decorator-order.usage.ts{typescript}

## Options Reference

```typescript
interface IWithLockOptions {
  key: string | ((...args: unknown[]) => string);  // Lock key or key builder
  ttl?: number;                                     // Lock TTL (ms)
  waitTimeout?: number;                             // Max wait time (ms)
  autoRenew?: boolean;                              // Enable auto-renewal
  onLockFailed?: 'throw' | 'skip' | ((key: string) => Error);  // Failure strategy
}
```

## Key Patterns

### Static Key

```typescript
// Global lock — only one instance runs at a time
@WithLock({ key: 'sync:products' })
async syncProducts(): Promise<void> {
  // Global product sync
}
```

### Parameter-Based Key

```typescript
// {0} = first argument
@WithLock({ key: 'user:{0}' })
async updateUser(userId: string, data: UpdateDto): Promise<User> {
  // Lock per user
}

// {1} = second argument
@WithLock({ key: 'order:{0}:item:{1}' })
async updateOrderItem(orderId: string, itemId: string): Promise<void> {
  // Lock per order+item combination
}
```

### Object Property Key

```typescript
// Access DTO properties
@WithLock({ key: 'payment:{0.orderId}' })
async processPayment(dto: PaymentDto): Promise<Payment> {
  return this.paymentGateway.charge(dto);
}
```

### Dynamic Key Function

```typescript
@WithLock({ 
  key: (userId, action) => `user:${userId}:${action}`,
  ttl: 5000,
})
async performAction(userId: string, action: string): Promise<void> {
  // Custom key logic
}
```

## TTL Configuration

```typescript
// Short operation
@WithLock({ key: 'quick:{0}', ttl: 5000 })  // 5 seconds
async quickUpdate(id: string) { }

// Long operation with auto-renewal
@WithLock({ key: 'long:{0}', ttl: 60000, autoRenew: true })  // 1 min + renew
async longProcess(id: string) { }
```

## Error Handling

### Throw on Failure (Default)

```typescript
@WithLock({ key: 'payment:{0}', onLockFailed: 'throw' })
async processPayment(orderId: string) {
  // Throws LockAcquisitionError if lock not acquired
}
```

### Skip on Failure

```typescript
@WithLock({ key: 'optional:{0}', onLockFailed: 'skip' })
async optionalTask(id: string) {
  // Returns undefined if lock not acquired
  // Method not executed
}
```

### Custom Error

```typescript
@WithLock({ 
  key: 'payment:{0}', 
  onLockFailed: (key) => new ConflictException(`Order ${key} already being processed`)
})
async processPayment(orderId: string) {
  // Throws custom error
}
```

## Retry Behavior

The `@WithLock` decorator uses the global retry settings configured in `LocksPlugin`.

::: tip Per-operation retry control
For per-operation retry overrides, use the [Service API](./service-api) directly:

```typescript
const lock = await this.lockService.acquire('key', {
  retry: { maxRetries: 5, initialDelay: 200 },
});
```
:::

## Real-World Examples

### Payment Processing

```typescript
@WithLock({
  key: 'payment:order:{0}',
  ttl: 30000,
})
async processPayment(orderId: string): Promise<Payment> {
  const order = await this.orders.findOne(orderId);
  
  if (order.paid) {
    throw new BadRequestException('Already paid');
  }
  
  const result = await this.gateway.charge(order);
  await this.orders.markPaid(orderId);
  
  return result;
}
```

### Inventory Management

```typescript
@WithLock({ key: 'inventory:{0}', ttl: 5000 })
async reserveStock(sku: string, quantity: number): Promise<boolean> {
  const stock = await this.inventory.getStock(sku);
  
  if (stock < quantity) {
    return false;
  }
  
  await this.inventory.decrement(sku, quantity);
  return true;
}
```

### Leader Election

```typescript
@WithLock({ 
  key: 'leader:scheduler',
  ttl: 60000,
  autoRenew: true,
})
async runScheduler(): Promise<void> {
  // Only one instance becomes leader
  while (this.running) {
    await this.processScheduledJobs();
    await this.sleep(10000);
  }
}
```

## Best Practices

### Do

```typescript
// Use specific keys
@WithLock({ key: 'user:{0}:profile' })

// Set appropriate TTL
@WithLock({ key: 'task:{0}', ttl: 10000 })

// Enable auto-renew for long tasks
@WithLock({ key: 'report:{0}', ttl: 60000, autoRenew: true })
```

### Don't

```typescript
// Too generic key
@WithLock({ key: 'lock' })  // Blocks everything!

// TTL too short
@WithLock({ key: 'slow:{0}', ttl: 1000 })  // 1s for slow operation

// Missing auto-renew for long operation
@WithLock({ key: 'export:{0}', ttl: 30000 })  // May expire mid-export
```

## Next Steps

- [Service API](./service-api) — Programmatic lock management
- [Auto-Renewal](./auto-renewal) — How auto-renewal works
