---
title: Testing
description: Testing idempotent endpoints and services
---

# Testing

Test services that use idempotency.

## Mock IdempotencyService

```typescript
import { Test } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';
import {
  IDEMPOTENCY_SERVICE,
  type IIdempotencyService,
} from '@nestjs-redisx/idempotency';

describe('PaymentController', () => {
  let controller: PaymentController;
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
      controllers: [PaymentController],
      providers: [
        PaymentService,
        {
          provide: IDEMPOTENCY_SERVICE,
          useValue: mockIdempotency,
        },
      ],
    }).compile();

    controller = module.get(PaymentController);
    idempotency = module.get(IDEMPOTENCY_SERVICE);
  });

  it('should process new request', async () => {
    idempotency.checkAndLock.mockResolvedValue({
      isNew: true,
    });

    await controller.createPayment({
      amount: 100,
      currency: 'USD',
    });

    expect(idempotency.complete).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        statusCode: 201,
      }),
    );
  });

  it('should return cached response for duplicate', async () => {
    const cachedResponse = { id: 456, status: 'completed' };

    idempotency.checkAndLock.mockResolvedValue({
      isNew: false,
      record: {
        key: 'pay-123',
        fingerprint: 'abc',
        status: 'completed',
        response: JSON.stringify(cachedResponse),
        statusCode: 201,
        startedAt: Date.now(),
        completedAt: Date.now(),
      },
    });

    const result = await controller.createPayment({
      amount: 100,
      currency: 'USD',
    });

    expect(result).toEqual(cachedResponse);
    expect(idempotency.complete).not.toHaveBeenCalled();
  });
});
```

## Integration Tests

```typescript
describe('Idempotency (integration)', () => {
  let app: INestApplication;
  let redis: Redis;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        RedisModule.forRoot({
          clients: { host: 'localhost', port: 6379 },
          plugins: [
            new IdempotencyPlugin({
              defaultTtl: 86400,
            }),
          ],
        }),
        PaymentsModule,
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();

    redis = new Redis({ host: 'localhost', port: 6379 });
  });

  afterAll(async () => {
    await redis.flushall();
    await redis.quit();
    await app.close();
  });

  afterEach(async () => {
    await redis.flushdb();
  });

  it('should create payment once for same key', async () => {
    const key = 'payment-123';

    // First request
    const response1 = await request(app.getHttpServer())
      .post('/payments')
      .set('Idempotency-Key', key)
      .send({ amount: 100, currency: 'USD' })
      .expect(201);

    // Second request with same key
    const response2 = await request(app.getHttpServer())
      .post('/payments')
      .set('Idempotency-Key', key)
      .send({ amount: 100, currency: 'USD' })
      .expect(201);

    // Same response
    expect(response1.body.id).toBe(response2.body.id);

    // Only one payment in database
    const payments = await db.payments.findAll();
    expect(payments).toHaveLength(1);
  });

  it('should reject fingerprint mismatch', async () => {
    const key = 'payment-123';

    // First request
    await request(app.getHttpServer())
      .post('/payments')
      .set('Idempotency-Key', key)
      .send({ amount: 100 })
      .expect(201);

    // Second request with different data
    await request(app.getHttpServer())
      .post('/payments')
      .set('Idempotency-Key', key)
      .send({ amount: 200 })  // Different!
      .expect(422);
  });

  it('should cache response headers', async () => {
    const key = 'payment-123';

    const response1 = await request(app.getHttpServer())
      .post('/payments')
      .set('Idempotency-Key', key)
      .send({ amount: 100 });

    const paymentId = response1.headers['x-payment-id'];

    // Duplicate request
    const response2 = await request(app.getHttpServer())
      .post('/payments')
      .set('Idempotency-Key', key)
      .send({ amount: 100 });

    // Header replayed
    expect(response2.headers['x-payment-id']).toBe(paymentId);
  });
});
```

## Testing Concurrent Requests

```typescript
describe('Concurrent requests', () => {
  it('should handle simultaneous requests', async () => {
    const key = 'payment-123';
    const dto = { amount: 100, currency: 'USD' };

    // Send 5 requests simultaneously
    const requests = Array.from({ length: 5 }, () =>
      request(app.getHttpServer())
        .post('/payments')
        .set('Idempotency-Key', key)
        .send(dto)
    );

    const responses = await Promise.all(requests);

    // All should succeed
    responses.forEach(r => expect(r.status).toBe(201));

    // All should return same payment ID
    const paymentIds = responses.map(r => r.body.id);
    const uniqueIds = new Set(paymentIds);
    expect(uniqueIds.size).toBe(1);

    // Only one payment created
    const payments = await db.payments.findAll();
    expect(payments).toHaveLength(1);
  });

  it('should wait for first request to complete', async () => {
    const key = 'payment-123';

    // Slow handler (simulated with delay)
    vi.spyOn(paymentService, 'process')
      .mockImplementation(() => sleep(1000).then(() => ({ id: 456 })));

    const start = Date.now();

    // Two concurrent requests
    const [response1, response2] = await Promise.all([
      request(app.getHttpServer())
        .post('/payments')
        .set('Idempotency-Key', key)
        .send({ amount: 100 }),
      request(app.getHttpServer())
        .post('/payments')
        .set('Idempotency-Key', key)
        .send({ amount: 100 }),
    ]);

    const duration = Date.now() - start;

    // Both succeed
    expect(response1.status).toBe(201);
    expect(response2.status).toBe(201);

    // Second waited for first
    expect(duration).toBeGreaterThan(1000);
    expect(duration).toBeLessThan(2000);  // Not 2x duration

    // Same response
    expect(response1.body.id).toBe(response2.body.id);
  });
});
```

## Testing Decorators

```typescript
describe('@Idempotent decorator', () => {
  @Controller('test')
  class TestController {
    @Post('orders')
    @Idempotent({ ttl: 3600 })
    async createOrder(@Body() dto: any) {
      return { id: 123, ...dto };
    }
  }

  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        RedisModule.forRoot({
          clients: { host: 'localhost', port: 6379 },
          plugins: [new IdempotencyPlugin()],
        }),
      ],
      controllers: [TestController],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  it('should apply idempotency to decorated method', async () => {
    const key = 'order-123';

    const response1 = await request(app.getHttpServer())
      .post('/test/orders')
      .set('Idempotency-Key', key)
      .send({ item: 'Widget' })
      .expect(201);

    const response2 = await request(app.getHttpServer())
      .post('/test/orders')
      .set('Idempotency-Key', key)
      .send({ item: 'Widget' })
      .expect(201);

    expect(response1.body).toEqual(response2.body);
  });
});
```

## Testing Error Scenarios

```typescript
describe('Error handling', () => {
  it('should cache errors', async () => {
    vi.spyOn(paymentService, 'process')
      .mockRejectedValue(new Error('Payment failed'));

    const key = 'payment-123';

    // First request fails
    await request(app.getHttpServer())
      .post('/payments')
      .set('Idempotency-Key', key)
      .send({ amount: 100 })
      .expect(500);

    // Duplicate request gets same error
    await request(app.getHttpServer())
      .post('/payments')
      .set('Idempotency-Key', key)
      .send({ amount: 100 })
      .expect(500);

    // Service called only once
    expect(paymentService.process).toHaveBeenCalledTimes(1);
  });

  it('should handle timeout', async () => {
    vi.spyOn(paymentService, 'process')
      .mockImplementation(() => sleep(65000));  // Longer than timeout

    const key = 'payment-123';

    await request(app.getHttpServer())
      .post('/payments')
      .set('Idempotency-Key', key)
      .send({ amount: 100 })
      .expect(408);  // Timeout
  });
});
```

## Testing TTL

```typescript
describe('TTL expiration', () => {
  it('should allow reuse after TTL expires', async () => {
    const key = 'payment-123';

    // First request
    const response1 = await request(app.getHttpServer())
      .post('/payments')
      .set('Idempotency-Key', key)
      .send({ amount: 100 });

    expect(response1.body.id).toBe(123);

    // Wait for TTL to expire (using short TTL for test)
    await sleep(2000);

    // Key expired, can be reused
    const response2 = await request(app.getHttpServer())
      .post('/payments')
      .set('Idempotency-Key', key)
      .send({ amount: 200 });  // Different amount OK now

    expect(response2.body.id).not.toBe(123);  // New payment
  });
});
```

## Mock Helper

```typescript
// test/helpers/idempotency.helper.ts
import { vi, type MockedObject } from 'vitest';
import type { IIdempotencyService } from '@nestjs-redisx/idempotency';

export function createMockIdempotencyService(): MockedObject<IIdempotencyService> {
  return {
    checkAndLock: vi.fn().mockResolvedValue({
      isNew: true,
    }),
    complete: vi.fn(),
    fail: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
  } as MockedObject<IIdempotencyService>;
}

// Usage in tests
const idempotency = createMockIdempotencyService();
```

## Test Utilities

```typescript
// test/utils/idempotency.utils.ts
export class IdempotencyTestUtils {
  static async clearAllKeys(redis: Redis): Promise<void> {
    const keys = await redis.keys('idempotency:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }

  static async getRecord(redis: Redis, key: string): Promise<any> {
    const data = await redis.get(`idempotency:${key}`);
    return data ? JSON.parse(data) : null;
  }

  static async setRecord(redis: Redis, key: string, record: any): Promise<void> {
    await redis.set(
      `idempotency:${key}`,
      JSON.stringify(record),
      'EX',
      3600,
    );
  }
}

// Usage
await IdempotencyTestUtils.clearAllKeys(redis);
const record = await IdempotencyTestUtils.getRecord(redis, 'payment-123');
```

## Next Steps

- [Recipes](./recipes) — Real-world examples
- [Troubleshooting](./troubleshooting) — Debug test failures
