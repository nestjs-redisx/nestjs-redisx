---
title: Troubleshooting
description: Common issues and solutions
---

# Troubleshooting

Common issues and how to fix them.

## Lock Acquisition Fails

### Problem: Always fails to acquire

**Symptoms:**
- `LockAcquisitionError` thrown
- Lock never acquired

**Solutions:**

1. **Check if lock is stuck:**
```bash
redis-cli GET _lock:your:key
# If exists, check TTL
redis-cli TTL _lock:your:key
```

2. **Increase retry attempts:**
```typescript
retry: {
  maxRetries: 10,  // More retries
}
```

3. **Shorten TTL:**
```typescript
ttl: 5000,  // Shorter locks
```

## Lock Expires Too Soon

### Problem: Lock expires during operation

**Symptoms:**
- `lock.isHeld()` returns `false` mid-operation
- `LockExtensionError` when calling `lock.extend()`
- Operation completes but lock is no longer in Redis

**Solutions:**

1. **Enable auto-renewal:**
```typescript
@WithLock({ key: 'long:{0}', autoRenew: true })
```

2. **Increase TTL:**
```typescript
ttl: 60000,  // Longer TTL
```

## Deadlock

### Problem: Circular wait for locks

**Symptoms:**
- Multiple services stuck waiting
- No progress

**Solution:**
Always acquire locks in consistent order:

```typescript
// Correct - sorted order
const [first, second] = [keyA, keyB].sort();
await lock(first);
await lock(second);

// Wrong - random order
await lock(keyA);
await lock(keyB);
```

## Performance Issues

### Problem: Lock acquisition slow

**Symptoms:**
- High latency
- Slow operations

**Solutions:**

1. **Check Redis latency:**
```bash
redis-cli --latency
```

2. **Reduce retry delay:**
```typescript
retry: {
  initialDelay: 50,  // Faster retry
}
```

3. **Use try-acquire for non-critical:**
```typescript
const lock = await this.lockService.tryAcquire(key);
if (!lock) return;  // Skip if busy
```

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `LockAcquisitionError` | Couldn't acquire lock | Increase retries or wait |
| `LockNotOwnedError` | Released wrong lock | Check token ownership |
| `LockExtensionError` | Lock extend failed (expired or not owned) | Check TTL, enable auto-renewal |

## Debug Checklist

- Redis is running
- Plugin registered in module
- Lock key is correct
- TTL is appropriate
- Auto-renewal enabled for long ops
- Retry settings reasonable
- No circular lock dependencies

## Next Steps

- [Monitoring](./monitoring) — Track lock performance
- [Overview](./index) — Back to overview
