---
title: Lock Issues
description: Troubleshoot distributed lock problems
---

# Lock Issues

Solutions for common lock problems.

## Problem: Lock Not Acquired

### Symptoms
- `LockTimeoutException` thrown
- Operations timing out waiting for lock
- High lock contention metrics

### Diagnosis

```bash
# Check if lock exists
redis-cli GET "lock:payment:order-123"

# Check TTL
redis-cli TTL "lock:payment:order-123"

# List all locks
redis-cli KEYS "lock:*"
```

### Solutions

| Cause | Solution |
|-------|----------|
| Lock held by another | Wait or increase timeout |
| Lock stuck (crash) | Wait for TTL expiration |
| Timeout too short | Increase `waitTimeout` option |
| TTL too long | Reduce lock TTL |

```typescript
// Increase timeout
@WithLock({
  key: 'resource:{0}',
  ttl: 30000,
  waitTimeout: 10000,  // Wait up to 10s for lock
})
```

---

## Problem: Deadlock

### Symptoms
- Multiple operations waiting forever
- Circular dependency
- System hangs

### Diagnosis

```bash
# Check which locks exist
redis-cli KEYS "lock:*"

# Check lock holders
for key in $(redis-cli KEYS "lock:*"); do
  echo "$key: $(redis-cli GET $key)"
done
```

### Solutions

| Cause | Solution |
|-------|----------|
| Circular lock acquisition | Always acquire locks in same order |
| Nested locks | Avoid or use lock hierarchy |
| Lock not released | Ensure finally block releases |

::: code-group
```typescript [Correct]
// Safe - consistent order
async operation1() {
  await lockA.acquire();
  await lockB.acquire();
}

async operation2() {
  await lockA.acquire();  // Same order
  await lockB.acquire();
}
```

```typescript [Wrong]
// Deadlock risk - inconsistent order
async operation1() {
  await lockA.acquire();
  await lockB.acquire();  // If operation2 holds B, waits for A
}

async operation2() {
  await lockB.acquire();
  await lockA.acquire();  // If operation1 holds A, waits for B
}
```
:::

---

## Problem: Lock Not Released

### Symptoms
- Lock stays held after operation completes
- TTL countdown but no release
- Next operation times out

### Diagnosis

```bash
# Check lock TTL
redis-cli TTL "lock:myresource"

# Check lock value (owner token)
redis-cli GET "lock:myresource"
```

### Solutions

| Cause | Solution |
|-------|----------|
| Exception before release | Use `finally` or decorator |
| Wrong release key | Verify key matches acquire |
| Token mismatch | Don't modify lock externally |

::: code-group
```typescript [Best]
// Decorator handles release automatically
@WithLock({ key: 'mykey' })
async process() {
  await this.riskyOperation();
}
```

```typescript [Good]
// Using try/finally - always releases
async process() {
  const lock = await this.lockService.acquire('key');
  try {
    await this.riskyOperation();
  } finally {
    await lock.release();
  }
}
```

```typescript [Wrong]
// Release might not happen if exception thrown
async process() {
  const lock = await this.lockService.acquire('key');
  await this.riskyOperation();  // If throws, lock not released
  await lock.release();
}
```
:::

---

## Problem: Lock Lost During Execution

### Symptoms
- Lock expired while still processing
- Another process acquired same lock
- Data corruption or duplicates

### Diagnosis

```bash
# Check if TTL expired
redis-cli TTL "lock:key"  # Returns -2 if expired

# Check auto-renewal logs
# Look for "lock renewal failed" messages
```

### Solutions

| Cause | Solution |
|-------|----------|
| TTL too short | Increase TTL |
| Auto-renew disabled | Enable `autoRenew` |
| Renewal failing | Check Redis connectivity |
| Operation too long | Increase TTL or break up operation |

```typescript
@WithLock({
  key: 'long-operation',
  ttl: 60000,  // Increase TTL
  autoRenew: {
    enabled: true,
    interval: 15000,  // Renew every 15s
  },
})
async longOperation() {
  // Operation can run up to TTL (renewed)
}
```

---

## Problem: High Lock Contention

### Symptoms
- Many lock timeouts
- High wait times
- Slow throughput

### Diagnosis

```yaml
# Lock wait time p99
histogram_quantile(0.99, rate(redisx_lock_wait_seconds_bucket[5m]))

# Timeout rate
rate(redisx_lock_timeouts_total[5m]) / rate(redisx_lock_attempts_total[5m])
```

### Solutions

| Cause | Solution |
|-------|----------|
| Lock scope too broad | Make keys more specific |
| Too many workers | Reduce concurrency |
| Hold time too long | Optimize locked code |

::: code-group
```typescript [Correct]
// Specific key - only blocks same order
@WithLock({ key: 'payment:{0}' })
async processPayment(orderId: string) { }
```

```typescript [Wrong]
// Too broad - blocks all payments
@WithLock({ key: 'payments' })
async processPayment(orderId: string) { }
```
:::

---

## Emergency: Force Release Lock

::: danger Emergency Only
Only use this when you're absolutely sure the lock holder is dead and won't recover.
:::

```bash
# Check the lock
redis-cli GET "lock:stuck-resource"

# Force delete (dangerous!)
redis-cli DEL "lock:stuck-resource"
```

::: tip Better Approach
Wait for TTL expiration or restart the holding process.
:::

## Next Steps

- [Cache Issues](./cache-issues) — Cache troubleshooting
- [Performance Issues](./performance-issues) — Latency problems
