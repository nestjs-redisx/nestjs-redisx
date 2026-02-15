---
title: Troubleshooting
description: Common issues and solutions
---

# Troubleshooting

Common issues and how to fix them.

## Fingerprint Mismatch Error

### Problem: 422 Error on legitimate retry

**Symptoms:**
- First request succeeds
- Retry with same key gets 422
- Error: "Fingerprint mismatch"

**Causes:**

1. **Request data changed:**
```typescript
// First request
POST /payments
Idempotency-Key: pay-123
Body: { amount: 100 }
→ Success

// Retry with DIFFERENT data
POST /payments
Idempotency-Key: pay-123
Body: { amount: 200 }  // ← Changed!
→ 422 Fingerprint mismatch
```

**Solution:** Use same data on retry, or generate new key for different data.

2. **Timestamp in fingerprint:**
```typescript
// Request includes timestamp
Body: { amount: 100, timestamp: Date.now() }

// On retry, timestamp changed!
Body: { amount: 100, timestamp: Date.now() }
→ Different fingerprint
```

**Solution:** Exclude volatile fields from fingerprint:

```typescript
new IdempotencyPlugin({
  fingerprintGenerator: (ctx) => {
    const req = ctx.switchToHttp().getRequest();
    const { timestamp, requestId, ...data } = req.body;
    return createHash('sha256')
      .update(JSON.stringify(data))
      .digest('hex');
  },
})
```

3. **Object key order:**
```typescript
// First request
Body: { amount: 100, currency: "USD" }

// Retry with different order
Body: { currency: "USD", amount: 100 }
→ Different fingerprint (if not normalized)
```

**Solution:** Normalize object keys:

```typescript
fingerprintGenerator: (ctx) => {
  const req = ctx.switchToHttp().getRequest();
  const normalized = JSON.stringify(
    req.body,
    Object.keys(req.body).sort()
  );
  return createHash('sha256').update(normalized).digest('hex');
}
```

## Missing Idempotency-Key Header

### Problem: No idempotency key in request

**Symptoms:**
- Error: "Idempotency-Key header required"
- Requests treated as non-idempotent

**Solutions:**

1. **Add header to request:**
```javascript
// ✅ Correct
fetch('/api/payments', {
  method: 'POST',
  headers: {
    'Idempotency-Key': crypto.randomUUID(),
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(data),
});

// ❌ Wrong - missing header
fetch('/api/payments', {
  method: 'POST',
  body: JSON.stringify(data),
});
```

2. **Check header name:**
```typescript
// Server expects (default):
'Idempotency-Key'

// Client sends:
'idempotency-key'  // ❌ Case-sensitive!
```

3. **Make idempotency optional:**
```typescript
new IdempotencyPlugin({
  errorPolicy: 'fail-open',  // Don't require header
})
```

## Timeout Errors

### Problem: 408 Request Timeout

**Symptoms:**
- Concurrent request waits too long
- Error: "Timeout waiting for completion"

**Causes:**

1. **First request too slow:**
```typescript
// Handler takes 2 minutes
@Post('process')
@Idempotent()
async process() {
  await this.slowOperation();  // 2 min
}

// But timeout is 60 seconds
waitTimeout: 60000  // ← Too short!
```

**Solution:** Increase timeouts:

```typescript
new IdempotencyPlugin({
  lockTimeout: 120000,   // 2 minutes
  waitTimeout: 240000,   // 4 minutes
})
```

2. **Lock not released:**
```typescript
@Post('process')
@Idempotent()
async process() {
  try {
    await this.work();
  } catch (error) {
    // Error thrown but lock not released!
    throw error;
  }
}
```

**Solution:** Lock is automatically released on error. Check for deadlocks.

## Duplicate Operations

### Problem: Operation executes multiple times

**Symptoms:**
- Same payment charged twice
- Multiple emails sent
- Duplicate database records

**Causes:**

1. **No idempotency key:**
```typescript
// Client doesn't send key
POST /payments
// No Idempotency-Key header
```

**Solution:** Always send idempotency key:

```javascript
const key = crypto.randomUUID();
await fetch('/api/payments', {
  headers: { 'Idempotency-Key': key },
});
```

2. **Different keys:**
```typescript
// First request
Idempotency-Key: key-1

// Retry with different key
Idempotency-Key: key-2  // ← New key = new operation!
```

**Solution:** Reuse same key on retry.

3. **Decorator not applied:**
```typescript
// ❌ Wrong - no decorator
@Post('payments')
async createPayment() {}

// ✅ Correct
@Post('payments')
@Idempotent()
async createPayment() {}
```

## Redis Connection Issues

### Problem: Redis unavailable

**Symptoms:**
- All requests fail
- Error: "Redis connection refused"

**Solutions:**

1. **Check Redis is running:**
```bash
redis-cli ping
# Should return: PONG
```

2. **Check connection config:**
```typescript
RedisModule.forRoot({
  clients: {
    host: 'localhost',  // Correct host?
    port: 6379,         // Correct port?
  },
})
```

3. **Use fail-open:**
```typescript
new IdempotencyPlugin({
  errorPolicy: 'fail-open',  // Allow requests if Redis down
})
```

::: warning Security Trade-off
fail-open reduces security but increases availability. Use only if needed.
:::

## TTL Issues

### Problem: Key expires too quickly

**Symptoms:**
- Client retries after TTL
- New operation created instead of returning cached
- "This shouldn't have charged twice"

**Solution:** Increase TTL:

```typescript
new IdempotencyPlugin({
  defaultTtl: 86400,  // 24 hours instead of 1 hour
})
```

**Guidelines:**

| Operation | TTL | Reason |
|-----------|-----|--------|
| Payments | 24-48h | Critical, users may retry next day |
| Orders | 4-24h | Session-based |
| Webhooks | 24-72h | External systems may replay |

## Memory Issues

### Problem: Redis memory growing

**Symptoms:**
- Redis memory usage increasing
- `OOM` errors
- Slow Redis responses

**Causes:**

1. **TTL not set:**
```typescript
// ❌ Records never expire
defaultTtl: 0  // Don't do this!

// ✅ Set reasonable TTL
defaultTtl: 86400  // 24 hours
```

2. **TTL too long:**
```typescript
// ❌ 30 days for everything
defaultTtl: 2592000

// ✅ Match to use case
payments: 86400,    // 24h
orders: 3600,       // 1h
webhooks: 86400,    // 24h
```

**Solution:** Adjust TTL and monitor memory:

```bash
# Check Redis memory
redis-cli INFO memory

# Check key count
redis-cli DBSIZE

# Find keys by pattern
redis-cli --scan --pattern 'idempotency:*'
```

## Common Errors

| Error | Status | Cause | Fix |
|-------|--------|-------|-----|
| Fingerprint mismatch | 422 | Request data changed | Use same data or new key |
| Missing key | 400 | No Idempotency-Key header | Add header |
| Timeout | 408 | Concurrent request waited too long | Increase timeout |
| Redis error | 503 | Redis unavailable | Check Redis connection |

## Debug Checklist

- [ ] Redis is running and accessible
- [ ] Plugin registered in module
- [ ] @Idempotent decorator applied
- [ ] Client sends Idempotency-Key header
- [ ] Same key used on retry
- [ ] Same request data on retry
- [ ] TTL appropriate for operation
- [ ] Timeouts configured correctly
- [ ] Fingerprint validation appropriate

## Debugging Tools

### Inspect Redis Keys

```bash
# List all idempotency keys
redis-cli --scan --pattern 'idempotency:*'

# Get specific key (stored as hash)
redis-cli HGETALL idempotency:payment-123

# Check TTL
redis-cli TTL idempotency:payment-123

# Delete specific key
redis-cli DEL idempotency:payment-123
```

### Enable Debug Logging

Use NestJS logger to see idempotency debug output:

```typescript
const app = await NestFactory.create(AppModule, {
  logger: ['debug', 'log', 'warn', 'error'],
});
```

### Test Endpoints

```bash
# Test with curl
KEY=$(uuidgen)

# First request
curl -i -X POST http://localhost:3000/payments \
  -H "Idempotency-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"amount": 100}'

# Duplicate (should return cached)
curl -i -X POST http://localhost:3000/payments \
  -H "Idempotency-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"amount": 100}'

# Mismatch (should return 422)
curl -i -X POST http://localhost:3000/payments \
  -H "Idempotency-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"amount": 200}'
```

## Getting Help

If still stuck:

1. Enable debug logging
2. Check Redis with `redis-cli`
3. Verify request headers with `curl -i`
4. Check server logs
5. Test with simple case first
6. Review [Configuration](./configuration) and [Fingerprinting](./fingerprinting) docs

## Next Steps

- [Monitoring](./monitoring) — Track operations
- [Overview](./index) — Back to overview
