---
title: "@Idempotent Decorator"
description: Declarative idempotency with method decorators
---

# @Idempotent Decorator

Make any endpoint idempotent with a single decorator.

## Basic Usage

```typescript
import { Controller, Post, Body } from '@nestjs/common';
import { Idempotent } from '@nestjs-redisx/idempotency';

@Controller('orders')
export class OrdersController {
  @Post()
  @Idempotent()
  async createOrder(@Body() dto: CreateOrderDto) {
    // Executes only once per Idempotency-Key
    return this.orderService.create(dto);
  }
}
```

## Options Reference

```typescript
interface IIdempotentOptions {
  ttl?: number;
  cacheHeaders?: string[];
  keyExtractor?: (context: ExecutionContext) => string | Promise<string>;
  fingerprintFields?: ('method' | 'path' | 'body' | 'query')[];
  validateFingerprint?: boolean;
  skip?: (context: ExecutionContext) => boolean | Promise<boolean>;
}
```

## TTL Configuration

```typescript
// Short TTL for temporary operations
@Post('sessions')
@Idempotent({ ttl: 300 })  // 5 minutes
async createSession() {}

// Standard TTL
@Post('orders')
@Idempotent({ ttl: 3600 })  // 1 hour
async createOrder() {}

// Long TTL for important operations
@Post('payments')
@Idempotent({ ttl: 86400 })  // 24 hours
async createPayment() {}
```

## Header Caching

Cache and replay response headers:

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

**First request:**
```http
HTTP/1.1 201 Created
Location: /resources/123
ETag: "v1"
X-Resource-Id: 123

{"id": 123, "name": "Resource"}
```

**Duplicate request (replayed):**
```http
HTTP/1.1 201 Created
Location: /resources/123    <- From cache
ETag: "v1"                  <- From cache
X-Resource-Id: 123          <- From cache

{"id": 123, "name": "Resource"}
```

## Custom Key Extraction

### From Query Parameter

```typescript
@Post('webhooks')
@Idempotent({
  keyExtractor: (ctx) => {
    const req = ctx.switchToHttp().getRequest();
    return req.query.webhookId;
  },
})
async handleWebhook(@Query('webhookId') id: string) {}

// Request: POST /webhooks?webhookId=hook-123
```

### From Body Field

```typescript
@Post('transactions')
@Idempotent({
  keyExtractor: (ctx) => {
    const req = ctx.switchToHttp().getRequest();
    return req.body.transactionId;
  },
})
async processTransaction(@Body() dto: TransactionDto) {}
```

### Composite Key

```typescript
@Post('transfers')
@Idempotent({
  keyExtractor: (ctx) => {
    const req = ctx.switchToHttp().getRequest();
    return `${req.user.id}:${req.body.transferId}`;
  },
})
async createTransfer(@Body() dto: TransferDto) {}
```

## Fingerprint Configuration

```typescript
// Include query params
@Post('search')
@Idempotent({
  fingerprintFields: ['method', 'path', 'body', 'query'],
})
async search(@Query() query, @Body() filters) {}

// Only method and path
@Post('ping')
@Idempotent({
  fingerprintFields: ['method', 'path'],
})
async ping() {}
```

## Skip Conditions

```typescript
// Skip for admins
@Post('orders')
@Idempotent({
  skip: (ctx) => {
    const req = ctx.switchToHttp().getRequest();
    return req.user?.role === 'admin';
  },
})
async createOrder() {}

// Skip in development
@Post('test')
@Idempotent({
  skip: () => process.env.NODE_ENV === 'development',
})
async testEndpoint() {}

// Skip for recurring operations
@Post('subscriptions/charge')
@Idempotent({
  skip: (ctx) => {
    const req = ctx.switchToHttp().getRequest();
    return req.body.type === 'recurring';
  },
})
async chargeSubscription() {}
```

## Real-World Examples

### Payment Processing

```typescript
@Post('payments')
@Idempotent({
  ttl: 86400,
  cacheHeaders: ['X-Payment-Id', 'X-Transaction-Reference'],
})
async processPayment(@Body() dto: PaymentDto, @Res() res: Response) {
  const payment = await this.paymentService.process(dto);

  res.setHeader('X-Payment-Id', payment.id);
  res.setHeader('X-Transaction-Reference', payment.reference);

  return res.status(201).json({
    id: payment.id,
    status: payment.status,
    amount: payment.amount,
  });
}
```

### Order Creation with Email

```typescript
@Post('orders')
@Idempotent({
  ttl: 3600,
  cacheHeaders: ['Location'],
})
async createOrder(@Body() dto: CreateOrderDto, @Res() res: Response) {
  // All of this runs ONCE per idempotency key
  const order = await this.orderService.create(dto);
  await this.emailService.sendConfirmation(order);
  await this.inventoryService.reserve(order.items);

  res.setHeader('Location', `/orders/${order.id}`);
  return res.status(201).json(order);
}
```

### Webhook Handler

```typescript
@Post('webhooks/stripe')
@Idempotent({
  ttl: 86400,
  keyExtractor: (ctx) => {
    const req = ctx.switchToHttp().getRequest();
    return req.headers['stripe-webhook-id'];
  },
})
async handleStripeWebhook(@Body() event: StripeEvent) {
  // Process webhook event
  await this.webhookService.process(event);
  return { received: true };
}
```

## Error Handling

<<< @/apps/demo/src/plugins/idempotency/decorator-error-handling.usage.ts{typescript}

## Next Steps

- [Service API](./service-api) — Programmatic access
- [Fingerprinting](./fingerprinting) — Deep dive
