---
title: Service API
description: Programmatic idempotency with IdempotencyService
---

# Service API

Use IdempotencyService for programmatic control.

## Service Injection

<<< @/apps/demo/src/plugins/idempotency/service-inject.usage.ts{typescript}

## checkAndLock() Method

Check if key exists and acquire lock if new:

```typescript
async processPayment(key: string, dto: PaymentDto): Promise<Payment> {
  const fingerprint = this.generateFingerprint(dto);

  const result = await this.idempotency.checkAndLock(key, fingerprint, {
    ttl: 86400,
  });

  if (!result.isNew && result.record?.status === 'completed') {
    // Return cached response
    return JSON.parse(result.record.response);
  }

  // New request - proceed with processing
  try {
    const payment = await this.doPayment(dto);
    await this.idempotency.complete(key, {
      statusCode: 201,
      body: payment,
    });
    return payment;
  } catch (error) {
    await this.idempotency.fail(key, error.message);
    throw error;
  }
}
```

::: info
Concurrent request handling (waiting for a lock held by another request) is done automatically inside `checkAndLock()`. If the key is being processed, the method polls until completion or timeout, then returns the cached result.
:::

## complete() Method

Mark operation as successfully completed:

```typescript
async createOrder(key: string, dto: CreateOrderDto): Promise<Order> {
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(dto))
    .digest('hex');

  await this.idempotency.checkAndLock(key, fingerprint);

  const order = await this.orderService.create(dto);
  await this.emailService.send(order);

  await this.idempotency.complete(key, {
    statusCode: 201,
    body: order,
    headers: {
      Location: `/orders/${order.id}`,
    },
  });

  return order;
}
```

## fail() Method

Mark operation as failed (takes key and error message):

```typescript
async processRequest(key: string, fingerprint: string): Promise<void> {
  await this.idempotency.checkAndLock(key, fingerprint);

  try {
    await this.doRiskyOperation();
    await this.idempotency.complete(key, {
      statusCode: 200,
      body: { success: true },
    });
  } catch (error) {
    // Store error for replay
    await this.idempotency.fail(key, error.message);
    throw error;
  }
}
```

## get() Method

Retrieve idempotency record:

```typescript
async getStatus(key: string): Promise<IdempotencyStatus> {
  const record = await this.idempotency.get(key);

  if (!record) {
    return { exists: false };
  }

  return {
    exists: true,
    status: record.status,
    completedAt: record.completedAt,
  };
}
```

## delete() Method

Remove idempotency record:

```typescript
async cancelOperation(key: string): Promise<void> {
  const record = await this.idempotency.get(key);

  if (record && record.status === 'processing') {
    throw new BadRequestException('Operation in progress');
  }

  await this.idempotency.delete(key);
}
```

## Manual Implementation Example

<<< @/apps/demo/src/plugins/idempotency/service-manual.usage.ts{typescript}

## Background Jobs

Use idempotency for job processing:

<<< @/apps/demo/src/plugins/idempotency/service-job-processor.usage.ts{typescript}

## Batch Operations

<<< @/apps/demo/src/plugins/idempotency/service-batch.usage.ts{typescript}

## Testing Support

Mock service for unit tests:

```typescript
import { Test } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';
import { IDEMPOTENCY_SERVICE, type IIdempotencyService } from '@nestjs-redisx/idempotency';

describe('PaymentService', () => {
  let service: PaymentService;
  let idempotency: MockedObject<IIdempotencyService>;

  beforeEach(async () => {
    const mockIdempotency: Partial<IIdempotencyService> = {
      checkAndLock: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        PaymentService,
        {
          provide: IDEMPOTENCY_SERVICE,
          useValue: mockIdempotency,
        },
      ],
    }).compile();

    service = module.get(PaymentService);
    idempotency = module.get(IDEMPOTENCY_SERVICE);
  });

  it('should process new request', async () => {
    idempotency.checkAndLock.mockResolvedValue({
      isNew: true,
    });

    await service.processPayment('pay-123', { amount: 100 });

    expect(idempotency.complete).toHaveBeenCalled();
  });

  it('should return cached response', async () => {
    idempotency.checkAndLock.mockResolvedValue({
      isNew: false,
      record: {
        key: 'pay-123',
        fingerprint: 'abc',
        status: 'completed',
        response: '{"id": 456}',
        statusCode: 201,
        startedAt: Date.now(),
        completedAt: Date.now(),
      },
    });

    const result = await service.processPayment('pay-123', { amount: 100 });

    expect(result).toEqual({ id: 456 });
    expect(idempotency.complete).not.toHaveBeenCalled();
  });
});
```

## Next Steps

- [Fingerprinting](./fingerprinting) — Deep dive into fingerprints
- [Testing](./testing) — Test idempotent code
