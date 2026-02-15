---
title: Spans
description: Create and manage custom spans
---

# Spans

Create custom spans to trace application-specific operations.

## TracingService

Inject `ITracingService` to create custom spans.

### Basic Usage

<<< @/apps/demo/src/plugins/tracing/service-basic.usage.ts{typescript}

**Result:**

```
GET /api/users/123
├── HTTP GET /api/users/123 (50ms)
│   └── user.get (45ms) ← Custom span
│       ├── Attribute: user.id = "123"
│       └── Event: user.found
```

## API Reference

### withSpan()

Create a span that wraps an async operation. Automatically ends the span and sets status.

```typescript
withSpan<T>(
  name: string,
  fn: () => T | Promise<T>,
  options?: ISpanOptions,
): Promise<T>
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Span name |
| `fn` | `() => T \| Promise<T>` | Function to trace |
| `options` | `ISpanOptions` | Optional span options |

**Returns:** Promise resolving to function result

**Example:**

```typescript
const result = await this.tracing.withSpan(
  'process.order',
  async () => {
    this.tracing.setAttribute('order.id', orderId);
    return await this.processOrder(orderId);
  },
  {
    kind: 'INTERNAL',
    attributes: {
      'service.name': 'order-service',
    },
  },
);
```

### startSpan()

Create a span manually (you must call `end()`).

```typescript
startSpan(name: string, options?: ISpanOptions): ISpan
```

**Example:**

```typescript
const span = this.tracing.startSpan('long.operation');

try {
  span.setAttribute('operation.type', 'batch');

  await this.step1();
  span.addEvent('step1.completed');

  await this.step2();
  span.addEvent('step2.completed');

  span.setStatus('OK');
} catch (error) {
  span.setStatus('ERROR');
  span.recordException(error);
  throw error;
} finally {
  span.end();  // ← MUST call end()
}
```

### getCurrentSpan()

Get the currently active span.

```typescript
getCurrentSpan(): ISpan | undefined
```

**Example:**

```typescript
@Get('/users/:id')
async getUser(@Param('id') id: string) {
  const span = this.tracing.getCurrentSpan();

  if (span) {
    span.setAttribute('user.id', id);
    span.addEvent('user.requested');
  }

  return this.userService.getUser(id);
}
```

## Span Attributes

Add metadata to spans.

### setAttribute()

```typescript
span.setAttribute('user.id', '123');
span.setAttribute('user.role', 'admin');
span.setAttribute('cache.hit', false);
span.setAttribute('request.size', 1024);
```

### setAttributes()

```typescript
span.setAttributes({
  'user.id': '123',
  'user.role': 'admin',
  'user.email': 'user@example.com',
});
```

### Semantic Conventions

Use standard attribute names when possible.

```typescript
// ✅ Good - Standard names
span.setAttributes({
  'db.system': 'redis',
  'db.operation': 'GET',
  'db.redis.key': 'user:123',
});

// ❌ Bad - Custom names
span.setAttributes({
  'database': 'redis',
  'command': 'GET',
  'key': 'user:123',
});
```

**Common conventions:**

| Category | Attributes | Example |
|----------|------------|---------|
| **Database** | `db.system`, `db.operation`, `db.statement` | `db.system: "redis"` |
| **HTTP** | `http.method`, `http.url`, `http.status_code` | `http.method: "GET"` |
| **RPC** | `rpc.system`, `rpc.service`, `rpc.method` | `rpc.service: "UserService"` |
| **Messaging** | `messaging.system`, `messaging.operation` | `messaging.system: "redis-streams"` |

## Span Events

Record point-in-time occurrences.

### addEvent()

```typescript
span.addEvent('cache.miss');
span.addEvent('query.slow', { duration_ms: 150 });
span.addEvent('validation.failed', {
  'validation.field': 'email',
  'validation.error': 'Invalid format',
});
```

**Timeline:**

```
Span: process.order (100ms)
├── t=0ms:   Start
├── t=10ms:  Event: validation.started
├── t=15ms:  Event: validation.completed
├── t=20ms:  Event: payment.processing
├── t=80ms:  Event: payment.completed
└── t=100ms: End
```

## Span Status

Indicate success or failure.

### Success

```typescript
span.setStatus('OK');
```

### Error

```typescript
span.setStatus('ERROR');
```

## Exception Recording

```typescript
try {
  await riskyOperation();
} catch (error) {
  span.recordException(error);
  span.setStatus('ERROR');
  throw error;
}
```

**Captured information:**
- Exception type
- Exception message
- Stack trace
- Timestamp

## Span Kinds

Categorize span types.

### INTERNAL

Internal operations (not the default — see CLIENT below).

```typescript
await this.tracing.withSpan('process.data', async () => {
  // ...
}, {
  kind: 'INTERNAL',
});
```

### CLIENT

Outgoing requests (HTTP, database, Redis). This is the default kind.

```typescript
await this.tracing.withSpan('api.call', async () => {
  return axios.get('https://api.example.com/data');
}, {
  kind: 'CLIENT',
});
```

### SERVER

Incoming requests.

```typescript
// Automatically set by HTTP instrumentation
@Get('/users')
async getUsers() {
  // Span kind: SERVER
}
```

### PRODUCER

Publishing messages.

```typescript
await this.tracing.withSpan('message.publish', async () => {
  await this.streamProducer.publish('orders', data);
}, {
  kind: 'PRODUCER',
});
```

### CONSUMER

Consuming messages.

```typescript
@StreamConsumer({ stream: 'orders' })
async handleOrder(message: IStreamMessage) {
  // Span kind: CONSUMER
}
```

## Nested Spans

Create parent-child relationships.

### Automatic Nesting

```typescript
async processOrder(orderId: string): Promise<void> {
  await this.tracing.withSpan('order.process', async () => {
    this.tracing.setAttribute('order.id', orderId);

    // Child span automatically linked
    await this.tracing.withSpan('order.validate', async () => {
      this.tracing.setAttribute('validation.type', 'schema');
      await this.validateOrder(orderId);
    });

    // Another child span
    await this.tracing.withSpan('payment.charge', async () => {
      this.tracing.setAttribute('payment.method', 'card');
      await this.chargePayment(orderId);
    });
  });
}
```

**Result:**

```
order.process (100ms)
├── order.validate (10ms)
└── payment.charge (80ms)
```

### Manual Nesting

For manual span nesting, use `withSpan` which automatically propagates context:

```typescript
await this.tracing.withSpan('parent', async () => {
  // Child span automatically linked via context
  await this.tracing.withSpan('child', async () => {
    // ...
  });
});
```

## Real-World Examples

### E-commerce Order Processing

<<< @/apps/demo/src/plugins/tracing/recipes/order-processing.usage.ts{typescript}

### User Registration Flow

<<< @/apps/demo/src/plugins/tracing/recipes/user-registration.usage.ts{typescript}

### Batch Processing

<<< @/apps/demo/src/plugins/tracing/recipes/batch-processing.usage.ts{typescript}

## Best Practices

**1. Use withSpan() for automatic cleanup**

```typescript
// ✅ Good - Automatic span.end() and status
await this.tracing.withSpan('operation', async () => {
  await doWork();
});

// ❌ Risky - Manual span.end()
const span = this.tracing.startSpan('operation');
await doWork();
span.end();  // Skipped if error thrown!
```

**2. Add meaningful attributes**

```typescript
// ✅ Good
span.setAttributes({
  'user.id': user.id,
  'user.role': user.role,
  'operation.type': 'batch',
});

// ❌ Bad - Too generic
span.setAttribute('data', JSON.stringify(user));
```

**3. Record events for milestones**

```typescript
span.addEvent('validation.started');
await validate();
span.addEvent('validation.completed');
```

**4. Set status appropriately**

```typescript
try {
  await operation();
  span.setStatus('OK');
} catch (error) {
  span.setStatus('ERROR');
  span.recordException(error);
  throw error;
}
```

**5. Keep span names concise**

```typescript
// ✅ Good
'user.get', 'order.create', 'payment.process'

// ❌ Bad
'getUserFromDatabaseWithCaching', 'processOrderAndSendEmail'
```

## Next Steps

- [Plugin Tracing](./plugin-tracing) — Automatic plugin traces
- [Visualization](./visualization) — Analyze traces
- [Troubleshooting](./troubleshooting) — Debug tracing issues
