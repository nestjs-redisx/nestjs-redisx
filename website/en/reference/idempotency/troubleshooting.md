---
title: 'Troubleshooting Guide — Idempotency Plugin | NestJS RedisX'
description: 'Troubleshoot idempotency fingerprint mismatches, lock wait timeouts, failed-key retries, Idempotency-Key header handling, and stuck records in the NestJS Redis idempotency plugin.'
---

# Troubleshooting

Common issues and how to fix them.

## Fingerprint Mismatch Error

### Problem: Error on legitimate retry

::: warning Surfaces as HTTP 500
`IdempotencyFingerprintMismatchError` extends `RedisXError` (a plain `Error`), **not**
`HttpException`, and the plugin registers **no** exception filter for it. As a result a
fingerprint mismatch currently surfaces as a generic **HTTP 500**, not a 4xx. If you want a
specific status (e.g. 409/422), add your own NestJS exception filter for
`IdempotencyFingerprintMismatchError`.
:::

**Symptoms:**
- First request succeeds
- Retry with same key but different request data fails
- Server returns HTTP 500; logs show `IdempotencyFingerprintMismatchError` / "Fingerprint mismatch"

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
- Requests are NOT deduplicated (the interceptor skips them when no key is present)
- No error is thrown for a missing key — duplicate operations may occur

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

3. **Idempotency is already optional per request:**

Requests that arrive **without** an idempotency key are passed straight through — the
interceptor skips deduplication when no key is present. There is no "require key" enforcement
to disable, and `errorPolicy` does not control this (it is currently a no-op; see
[Configuration](./configuration)). If you want a missing key to be an error, enforce it in your
own validation/guard.

## Timeout Errors

### Problem: Request Timeout while waiting for a concurrent request

::: warning Surfaces as HTTP 500
`IdempotencyTimeoutError` extends `RedisXError` (not `HttpException`) and has no registered
exception filter, so it currently surfaces as **HTTP 500**, not 408. Add your own exception
filter if you need a specific status.
:::

**Symptoms:**
- A concurrent request with the same key waits longer than `waitTimeout` for the in-flight
  request to complete
- Server returns HTTP 500; logs show `IdempotencyTimeoutError` / "Timeout waiting for completion"

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

## Retrying a Previously-Failed Key

### Problem: Retry of a failed request keeps returning HTTP 500

**Symptoms:**
- First attempt with a key throws inside the handler (the operation failed)
- Retrying with the **same** key returns HTTP 500 for a while, then eventually works

**Why this happens (current behavior):**

When the handler throws, the interceptor records the key as `failed`. A subsequent retry of the
same key sees the `failed` record and throws `IdempotencyFailedError`. Like the fingerprint
mismatch error, this extends `RedisXError` (not `HttpException`) and has **no** registered
exception filter, so it surfaces as **HTTP 500**.

The failed record is also **sticky**: `fail()` does **not** set a TTL, so the key keeps the
expiry from when the lock was created — i.e. it stays locked for roughly the remaining
`lockTimeout` window (default `30000` ms, applied via `PEXPIRE` when the lock was first
acquired). Until that window elapses and the key expires, every retry of the same key keeps
returning HTTP 500. After the key expires, a fresh attempt is allowed.

**Implications:**
- A client that retries immediately after a failure will receive HTTP 500 until the
  `lockTimeout` window passes — it cannot retry successfully right away.
- To allow an immediate clean retry, use a **new** idempotency key for the retry, or explicitly
  delete the failed key (see [Inspect Redis Keys](#debugging-tools)).

::: tip
If you need a specific HTTP status for failed/mismatch cases instead of 500, register a NestJS
exception filter that maps `IdempotencyFailedError` and `IdempotencyFingerprintMismatchError`
to the status codes you want.
:::

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

::: warning No fail-open today
There is **no** working fail-open mode. The `errorPolicy: 'fail-open'` option is accepted but
**not honored** — the interceptor does not catch Redis errors, so if Redis is unavailable the
request fails hard (surfacing as HTTP 500) regardless of `errorPolicy`. Keep Redis healthy and
monitored; do not rely on `errorPolicy` for availability. See
[Configuration](./configuration).
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

All idempotency errors extend `RedisXError` (a plain `Error`), and the plugin registers **no**
exception filter — so they all surface as **HTTP 500** unless you add your own filter to remap
them.

| Error | Default HTTP status | Cause | Fix |
|-------|---------------------|-------|-----|
| `IdempotencyFingerprintMismatchError` | 500 | Same key, different request data | Use same data or a new key; add a filter to remap to 409/422 |
| `IdempotencyFailedError` | 500 | Retry of a key whose first attempt failed (sticky until ~`lockTimeout` expiry) | Use a new key or wait for the key to expire |
| `IdempotencyTimeoutError` | 500 | Concurrent request waited longer than `waitTimeout` | Increase timeouts; speed up handler |
| Missing key | n/a (passed through) | No idempotency key on the request | Deduplication is skipped; send a key to enable it |
| Redis error | 500 | Redis unavailable (no fail-open) | Keep Redis healthy; `errorPolicy` does not help |

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

# Mismatch (same key, different body) — currently returns HTTP 500
# (IdempotencyFingerprintMismatchError, no exception filter)
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
