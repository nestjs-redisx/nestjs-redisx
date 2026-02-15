---
title: Header Caching
description: Cache and replay response headers with idempotent requests
---

# Header Caching

Cache response headers along with the response body for complete idempotency.

## Why Cache Headers?

Some headers contain important metadata that must be consistent across retries:

```http
POST /resources
Idempotency-Key: res-123

HTTP/1.1 201 Created
Location: /resources/456        ← Important!
ETag: "v1"                      ← Important!
X-Resource-Id: 456              ← Important!

{"id": 456, "name": "Resource"}
```

On retry, clients expect the **same headers**:

```http
POST /resources
Idempotency-Key: res-123

HTTP/1.1 201 Created
Location: /resources/456        ← Must be same!
ETag: "v1"                      ← Must be same!
X-Resource-Id: 456              ← Must be same!

{"id": 456, "name": "Resource"}
```

## Configuration

### Via Decorator

```typescript
@Post('resources')
@Idempotent({
  cacheHeaders: ['Location', 'ETag', 'X-Resource-Id'],
})
async createResource(@Res() res: Response) {
  const resource = await this.service.create();

  res.setHeader('Location', `/resources/${resource.id}`);
  res.setHeader('ETag', resource.version);
  res.setHeader('X-Resource-Id', resource.id);

  return res.status(201).json(resource);
}
```

### Via Global Config

::: info
There is no global `defaultCacheHeaders` option. Use the `cacheHeaders` option per-endpoint via the `@Idempotent` decorator.
:::

## Common Headers to Cache

### Location

For resource creation:

```typescript
@Post('orders')
@Idempotent({
  cacheHeaders: ['Location'],
})
async createOrder(@Res() res: Response) {
  const order = await this.service.create();
  res.setHeader('Location', `/orders/${order.id}`);
  return res.status(201).json(order);
}
```

### ETag

For versioning:

```typescript
@Post('documents')
@Idempotent({
  cacheHeaders: ['ETag'],
})
async createDocument(@Res() res: Response) {
  const doc = await this.service.create();
  res.setHeader('ETag', `"${doc.version}"`);
  return res.status(201).json(doc);
}
```

### Custom Headers

For application-specific metadata:

```typescript
@Post('payments')
@Idempotent({
  cacheHeaders: [
    'X-Payment-Id',
    'X-Transaction-Reference',
    'X-Processing-Time',
  ],
})
async createPayment(@Res() res: Response) {
  const start = Date.now();
  const payment = await this.service.process();
  const time = Date.now() - start;

  res.setHeader('X-Payment-Id', payment.id);
  res.setHeader('X-Transaction-Reference', payment.reference);
  res.setHeader('X-Processing-Time', `${time}ms`);

  return res.status(201).json(payment);
}
```

## What Gets Cached

| Header Category | Cached | Notes |
|----------------|--------|-------|
| Explicitly listed | Yes | Via `cacheHeaders` |
| Standard headers | No | Content-Type, Content-Length (auto) |
| Authentication | No | Never cached |
| Cookies | No | Never cached |
| Date/Time | No | Would be stale |

## Storage Format

Headers are stored as JSON in Redis:

```json
{
  "key": "res-123",
  "status": "completed",
  "statusCode": 201,
  "response": "{\"id\":456,\"name\":\"Resource\"}",
  "headers": {
    "Location": "/resources/456",
    "ETag": "\"v1\"",
    "X-Resource-Id": "456"
  },
  "completedAt": 1706123456000
}
```

## Replay Behavior

### First Request

```http
POST /resources HTTP/1.1
Idempotency-Key: res-123
Content-Type: application/json

{"name": "New Resource"}
```

**Response:**
```http
HTTP/1.1 201 Created
Location: /resources/456
ETag: "v1"
X-Resource-Id: 456
Content-Type: application/json

{"id": 456, "name": "New Resource"}
```

### Duplicate Request

```http
POST /resources HTTP/1.1
Idempotency-Key: res-123
Content-Type: application/json

{"name": "New Resource"}
```

**Response (from cache):**
```http
HTTP/1.1 201 Created
Location: /resources/456        ← From cache
ETag: "v1"                      ← From cache
X-Resource-Id: 456              ← From cache
Content-Type: application/json  ← Auto

{"id": 456, "name": "New Resource"}
```

## Implementation Example

### Setting Headers

```typescript
@Post('orders')
@Idempotent({
  ttl: 3600,
  cacheHeaders: ['Location', 'X-Order-Number'],
})
async createOrder(
  @Body() dto: CreateOrderDto,
  @Res() res: Response,
) {
  const order = await this.orderService.create(dto);
  await this.emailService.sendConfirmation(order);

  // Set headers that will be cached
  res.setHeader('Location', `/orders/${order.id}`);
  res.setHeader('X-Order-Number', order.orderNumber);

  return res.status(201).json({
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    total: order.total,
  });
}
```

### Reading Headers (Client)

```typescript
// Client code
const response = await fetch('/orders', {
  method: 'POST',
  headers: {
    'Idempotency-Key': 'order-123',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ items: [...] }),
});

const location = response.headers.get('Location');
const orderNumber = response.headers.get('X-Order-Number');

console.log('Created order:', location);
console.log('Order number:', orderNumber);
```

## Programmatic API

### Via Service

```typescript
import { IIdempotencyService } from '@nestjs-redisx/idempotency';

async createResource(key: string, dto: CreateDto): Promise<Response> {
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(dto))
    .digest('hex');

  const result = await this.idempotency.checkAndLock(key, fingerprint);

  if (!result.isNew && result.record?.status === 'completed') {
    return {
      statusCode: result.record.statusCode,
      body: JSON.parse(result.record.response),
      headers: JSON.parse(result.record.headers || '{}'),  // ← Cached headers
    };
  }

  const resource = await this.service.create(dto);

  await this.idempotency.complete(key, {
    statusCode: 201,
    body: resource,
    headers: {
      Location: `/resources/${resource.id}`,
      ETag: `"${resource.version}"`,
    },
  });

  return {
    statusCode: 201,
    body: resource,
    headers: {
      Location: `/resources/${resource.id}`,
      ETag: `"${resource.version}"`,
    },
  };
}
```

## Best Practices

### Do

```typescript
// ✅ Cache resource identifiers
cacheHeaders: ['Location', 'X-Resource-Id']

// ✅ Cache versioning headers
cacheHeaders: ['ETag', 'Last-Modified']

// ✅ Cache custom metadata
cacheHeaders: ['X-Request-Id', 'X-Trace-Id']

// ✅ Use consistent header names
'X-Order-ID' (not mixed case like 'x-Order-Id')
```

### Don't

```typescript
// ❌ Cache authentication headers
cacheHeaders: ['Authorization']  // Security risk!

// ❌ Cache time-sensitive headers
cacheHeaders: ['Date', 'Expires']  // Will be stale

// ❌ Cache cookies
cacheHeaders: ['Set-Cookie']  // Never cache these

// ❌ Cache too many headers
cacheHeaders: ['Header1', 'Header2', ..., 'Header50']  // Wasteful
```

## Troubleshooting

### Headers Not Being Replayed

**Check configuration:**

```typescript
@Idempotent({
  cacheHeaders: ['Location'],  // ← Is this set?
})
```

**Check header name matches:**

```typescript
// Setting:
res.setHeader('location', '/resource/123');  // lowercase

// Caching:
cacheHeaders: ['Location']  // ← Case mismatch!

// Fix: Use consistent case
res.setHeader('Location', '/resource/123');
```

### Headers Appear on First Request Only

This is expected behavior. Headers are only cached on the first request and replayed on duplicates.

## Next Steps

- [Client Guide](./client-guide) — Client-side implementation
- [Recipes](./recipes) — Real-world examples
