---
title: Fingerprinting
description: Request fingerprinting and validation
---

# Fingerprinting

Ensure idempotency keys are used correctly with request fingerprints.

## What is Fingerprinting?

A fingerprint is a hash of the request that uniquely identifies its content. It prevents accidental reuse of idempotency keys with different request data.

```mermaid
graph TB
    subgraph "Request Components"
        M[Method: POST]
        P[Path: /payments]
        B[Body: {amount:100}]
    end

    M --> H[Hash Function<br/>SHA-256]
    P --> H
    B --> H

    H --> F[Fingerprint:<br/>a1b2c3d4...]

    F --> S[Store in Redis]
```

## Why Fingerprint?

### Problem Without Fingerprinting

```typescript
// Request 1
POST /payments
Idempotency-Key: payment-123
Body: { amount: 100, currency: "USD" }
→ Creates payment for $100

// Request 2 (Bug: same key, different data!)
POST /payments
Idempotency-Key: payment-123
Body: { amount: 500, currency: "EUR" }
→ Returns $100 payment (WRONG!)
```

### Solution With Fingerprinting

```typescript
// Request 1
POST /payments
Idempotency-Key: payment-123
Body: { amount: 100 }
→ Fingerprint: abc123
→ Creates payment

// Request 2 (Different body)
POST /payments
Idempotency-Key: payment-123
Body: { amount: 500 }
→ Fingerprint: def456
→ ❌ Error: Fingerprint mismatch!
```

## How Fingerprints Are Generated

### Default Implementation

```typescript
import { createHash } from 'crypto';

function generateFingerprint(request: Request): string {
  const data = [
    request.method,          // POST
    request.path,            // /payments
    JSON.stringify(request.body),  // {"amount":100}
  ].join('|');

  return createHash('sha256')
    .update(data)
    .digest('hex');
}

// Result: "a1b2c3d4e5f6..." (64 hex chars)
```

### What Gets Hashed

By default:
```
method | path | body
POST | /payments | {"amount":100,"currency":"USD"}
→ SHA256
→ a1b2c3d4e5f6...
```

## Configuration

### Include Query Parameters

```typescript
new IdempotencyPlugin({
  fingerprintFields: ['method', 'path', 'body', 'query'],
})
```

```typescript
// Now this affects fingerprint:
POST /payments?source=stripe
Body: { amount: 100 }
→ Fingerprint: xyz789

POST /payments?source=paypal
Body: { amount: 100 }
→ Fingerprint: abc456  // Different!
```

### Only Path and Body

```typescript
new IdempotencyPlugin({
  fingerprintFields: ['path', 'body'],
})
```

```typescript
// Method doesn't matter:
POST /payments
Body: { amount: 100 }
→ Fingerprint: aaa111

PUT /payments
Body: { amount: 100 }
→ Fingerprint: aaa111  // Same!
```

## Custom Fingerprint Generator

### Ignore Certain Fields

```typescript
new IdempotencyPlugin({
  fingerprintGenerator: async (context) => {
    const req = context.switchToHttp().getRequest();

    // Ignore timestamp in body
    const { timestamp, ...relevantData } = req.body;

    return createHash('sha256')
      .update(`${req.method}|${req.path}|${JSON.stringify(relevantData)}`)
      .digest('hex');
  },
})
```

```typescript
// These are considered the same:
Body: { amount: 100, timestamp: 1706123456 }
Body: { amount: 100, timestamp: 1706123999 }
→ Same fingerprint (timestamp ignored)
```

### Include Headers

```typescript
new IdempotencyPlugin({
  fingerprintGenerator: async (context) => {
    const req = context.switchToHttp().getRequest();

    const data = [
      req.method,
      req.path,
      JSON.stringify(req.body),
      req.headers['x-tenant-id'],  // Include tenant
    ].join('|');

    return createHash('sha256').update(data).digest('hex');
  },
})
```

### Normalize Data

```typescript
new IdempotencyPlugin({
  fingerprintGenerator: async (context) => {
    const req = context.switchToHttp().getRequest();

    // Sort object keys for consistent hash
    const normalized = JSON.stringify(req.body, Object.keys(req.body).sort());

    return createHash('sha256')
      .update(`${req.method}|${req.path}|${normalized}`)
      .digest('hex');
  },
})
```

```typescript
// These become the same fingerprint:
Body: { amount: 100, currency: "USD" }
Body: { currency: "USD", amount: 100 }
→ Same fingerprint (keys sorted)
```

## Fingerprint Validation

### Strict Validation (Default)

```typescript
new IdempotencyPlugin({
  validateFingerprint: true,  // Default
})
```

```typescript
// Request 1
POST /payments
Idempotency-Key: pay-123
Body: { amount: 100 }
→ Success

// Request 2 (different body)
POST /payments
Idempotency-Key: pay-123
Body: { amount: 200 }
→ Error 422: Fingerprint mismatch
```

### Disable Validation

```typescript
new IdempotencyPlugin({
  validateFingerprint: false,  // No checking
})
```

::: warning Not Recommended
Disabling fingerprint validation can lead to incorrect behavior if clients reuse keys inappropriately.
:::

## Handling Mismatches

### Error Response

```http
HTTP/1.1 422 Unprocessable Entity
Content-Type: application/json

{
  "statusCode": 422,
  "error": "Fingerprint Mismatch",
  "message": "Idempotency key reused with different request data"
}
```

### Custom Error Handler

```typescript
import { IdempotencyFingerprintMismatchError } from '@nestjs-redisx/idempotency';

@Catch(IdempotencyFingerprintMismatchError)
export class FingerprintMismatchFilter implements ExceptionFilter {
  catch(exception: IdempotencyFingerprintMismatchError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();

    response.status(422).json({
      error: 'Invalid Request',
      message: 'This idempotency key was already used with different data',
      idempotencyKey: exception.idempotencyKey,
      suggestion: 'Use a new idempotency key for different request data',
    });
  }
}
```

## Best Practices

### Do

```typescript
// ✅ Include all relevant data
fingerprintFields: ['method', 'path', 'body']

// ✅ Normalize data if order doesn't matter
JSON.stringify(body, Object.keys(body).sort())

// ✅ Exclude volatile fields
const { timestamp, requestId, ...data } = req.body;

// ✅ Use SHA-256 for hashing
createHash('sha256')
```

### Don't

```typescript
// ❌ Include changing fields that don't affect operation
fingerprintGenerator: (ctx) => {
  return createHash('sha256')
    .update(`${req.body.timestamp}`)  // Changes every time!
    .digest('hex');
}

// ❌ Use weak hashing
createHash('md5')  // Not secure enough

// ❌ Disable validation without good reason
validateFingerprint: false
```

## Debugging Fingerprints

### Log Fingerprints

```typescript
new IdempotencyPlugin({
  fingerprintGenerator: async (context) => {
    const req = context.switchToHttp().getRequest();
    const data = `${req.method}|${req.path}|${JSON.stringify(req.body)}`;
    const fingerprint = createHash('sha256').update(data).digest('hex');

    console.log('Fingerprint:', fingerprint);
    console.log('Data:', data);

    return fingerprint;
  },
})
```

### Compare Requests

```bash
# Request 1
curl -X POST http://localhost:3000/payments \
  -H "Idempotency-Key: pay-123" \
  -d '{"amount": 100}'

# Server logs:
# Data: POST|/payments|{"amount":100}
# Fingerprint: a1b2c3d4...

# Request 2
curl -X POST http://localhost:3000/payments \
  -H "Idempotency-Key: pay-123" \
  -d '{"amount": 200}'

# Server logs:
# Data: POST|/payments|{"amount":200}
# Fingerprint: e5f6g7h8...
# Error: Mismatch! (a1b2c3d4 != e5f6g7h8)
```

## Next Steps

- [Concurrent Requests](./concurrent-requests) — Handle concurrent requests
- [Troubleshooting](./troubleshooting) — Debug fingerprint issues
