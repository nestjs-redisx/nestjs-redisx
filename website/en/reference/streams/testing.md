---
title: Testing
description: Testing stream producers and consumers
---

# Testing

Test stream-based applications.

## Mock Producer

```typescript
import { Test } from '@nestjs/testing';
import { STREAM_PRODUCER, IStreamProducer } from '@nestjs-redisx/streams';
import { vi, type MockedObject } from 'vitest';

describe('OrderService', () => {
  let service: OrderService;
  let mockProducer: MockedObject<IStreamProducer>;

  beforeEach(async () => {
    mockProducer = {
      publish: vi.fn().mockResolvedValue('1706123456789-0'),
      publishBatch: vi.fn().mockResolvedValue(['1706123456789-0']),
      getStreamInfo: vi.fn().mockResolvedValue({
        length: 100,
        groups: 1,
        firstEntry: { id: '1706123456789-0', timestamp: new Date() },
        lastEntry: { id: '1706123456799-0', timestamp: new Date() },
      }),
      trim: vi.fn().mockResolvedValue(0),
    };

    const module = await Test.createTestingModule({
      providers: [
        OrderService,
        {
          provide: STREAM_PRODUCER,
          useValue: mockProducer,
        },
      ],
    }).compile();

    service = module.get(OrderService);
  });

  it('should publish order event when order created', async () => {
    // Given
    const dto = { items: [], total: 100 };

    // When
    await service.createOrder(dto);

    // Then
    expect(mockProducer.publish).toHaveBeenCalledWith(
      'orders',
      expect.objectContaining({
        type: 'ORDER_CREATED',
        orderId: expect.any(String),
        total: 100,
      })
    );
  });

  it('should not fail if publish fails', async () => {
    // Given
    mockProducer.publish.mockRejectedValue(new Error('Redis down'));

    // When/Then - should not throw
    await expect(service.createOrder({ items: [], total: 100 }))
      .resolves.not.toThrow();
  });
});
```

## Mock Consumer

```typescript
describe('OrderProcessor', () => {
  let processor: OrderProcessor;
  let mockOrderService: MockedObject<OrderService>;

  beforeEach(() => {
    mockOrderService = {
      process: vi.fn().mockResolvedValue(undefined),
    };

    processor = new OrderProcessor(mockOrderService);
  });

  it('should process message and ack', async () => {
    // Given
    const message = createMockMessage({
      id: '1706123456789-0',
      data: { orderId: 'order-123' },
    });

    // When
    await processor.handleOrder(message);

    // Then
    expect(mockOrderService.process).toHaveBeenCalledWith(message.data);
    expect(message.ack).toHaveBeenCalled();
  });

  it('should reject on error', async () => {
    // Given
    const error = new Error('Processing failed');
    mockOrderService.process.mockRejectedValue(error);

    const message = createMockMessage({
      id: '1706123456789-0',
      data: { orderId: 'order-123' },
    });

    // When
    await processor.handleOrder(message);

    // Then
    expect(message.reject).toHaveBeenCalledWith(error);
  });
});

// Helper function
function createMockMessage<T>(options: {
  id: string;
  data: T;
  attempt?: number;
}): IStreamMessage<T> {
  return {
    id: options.id,
    stream: 'test-stream',
    data: options.data,
    attempt: options.attempt || 1,
    timestamp: new Date(),
    ack: vi.fn().mockResolvedValue(undefined),
    reject: vi.fn().mockResolvedValue(undefined),
  };
}
```

## Integration Tests

```typescript
import { Test } from '@nestjs/testing';
import { RedisModule } from '@nestjs-redisx/core';
import { StreamsPlugin, STREAM_PRODUCER, STREAM_CONSUMER } from '@nestjs-redisx/streams';
import Redis from 'ioredis';

describe('Streams (integration)', () => {
  let app: INestApplication;
  let redis: Redis;
  let producer: IStreamProducer;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        RedisModule.forRoot({
          clients: {
            host: 'localhost',
            port: 6379,
          },
          plugins: [
            new StreamsPlugin({
              consumer: {
                batchSize: 10,
                concurrency: 1,
              },
            }),
          ],
        }),
        OrderModule,
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();

    producer = app.get(STREAM_PRODUCER);
    redis = new Redis({ host: 'localhost', port: 6379 });
  });

  afterAll(async () => {
    await redis.flushall();
    await redis.quit();
    await app.close();
  });

  afterEach(async () => {
    // Clean up test streams
    await redis.del('test-stream');
    await redis.del('test-stream:dlq');
  });

  describe('publish', () => {
    it('should publish message to stream', async () => {
      // When
      const messageId = await producer.publish('test-stream', {
        orderId: 'order-123',
        total: 100,
      });

      // Then
      expect(messageId).toMatch(/^\d+-\d+$/);

      const info = await producer.getStreamInfo('test-stream');
      expect(info.length).toBe(1);
    });

    it('should publish batch of messages', async () => {
      // Given
      const messages = [
        { orderId: 'order-1', total: 100 },
        { orderId: 'order-2', total: 200 },
        { orderId: 'order-3', total: 300 },
      ];

      // When
      const messageIds = await producer.publishBatch('test-stream', messages);

      // Then
      expect(messageIds).toHaveLength(3);

      const info = await producer.getStreamInfo('test-stream');
      expect(info.length).toBe(3);
    });
  });

  describe('consume', () => {
    it('should consume and acknowledge message', async () => {
      // Given
      const data = { orderId: 'order-123', total: 100 };
      await producer.publish('test-stream', data);

      const processedMessages = [];

      // When
      const consumer = app.get(STREAM_CONSUMER);
      await consumer.createGroup('test-stream', 'test-group', '0');

      const handle = consumer.consume(
        'test-stream',
        'test-group',
        'test-consumer',
        async (message) => {
          processedMessages.push(message.data);
          await message.ack();
        },
        { batchSize: 10 }
      );

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 1000));

      await consumer.stop(handle);

      // Then
      expect(processedMessages).toHaveLength(1);
      expect(processedMessages[0]).toEqual(data);

      // Check pending count
      const pending = await consumer.getPending('test-stream', 'test-group');
      expect(pending.count).toBe(0);
    });

    it('should retry failed message', async () => {
      // Given
      await producer.publish('test-stream', { orderId: 'order-123' });

      let attempts = 0;

      // When
      const consumer = app.get(STREAM_CONSUMER);
      await consumer.createGroup('test-stream', 'test-group', '0');

      const handle = consumer.consume(
        'test-stream',
        'test-group',
        'test-consumer',
        async (message) => {
          attempts++;

          if (attempts < 3) {
            // Fail first 2 attempts
            await message.reject(new Error('Temporary failure'));
          } else {
            // Succeed on 3rd attempt
            await message.ack();
          }
        },
        { batchSize: 10, maxRetries: 5 }
      );

      // Wait for retries
      await new Promise(resolve => setTimeout(resolve, 5000));

      await consumer.stop(handle);

      // Then
      expect(attempts).toBeGreaterThanOrEqual(3);
    });
  });
});
```

## Test Patterns

### Test Consumer with Spy

```typescript
describe('OrderProcessor', () => {
  it('should call service method', async () => {
    // Given
    const spy = vi.spyOn(processor['orderService'], 'process');
    const message = createMockMessage({ id: 'msg-1', data: { orderId: 'order-123' } });

    // When
    await processor.handleOrder(message);

    // Then
    expect(spy).toHaveBeenCalledWith(message.data);
  });
});
```

### Test Idempotency

```typescript
describe('IdempotentConsumer', () => {
  it('should process message only once', async () => {
    // Given
    const processSpy = vi.spyOn(processor, 'processOrder');
    const message = createMockMessage({ id: 'msg-1', data: { orderId: 'order-123' } });

    // When - process same message twice
    await processor.handle(message);
    await processor.handle(message);

    // Then - processed only once
    expect(processSpy).toHaveBeenCalledTimes(1);
  });
});
```

### Test Retry Logic

```typescript
describe('RetryLogic', () => {
  it('should retry on transient error', async () => {
    // Given
    let attempts = 0;
    const service = {
      process: vi.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Transient error');
        }
      }),
    };

    const processor = new OrderProcessor(service);
    const message = createMockMessage({ id: 'msg-1', data: { orderId: 'order-123' } });

    // When
    await processor.handle(message);  // Attempt 1 - fail
    await processor.handle(message);  // Attempt 2 - fail
    await processor.handle(message);  // Attempt 3 - success

    // Then
    expect(attempts).toBe(3);
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.reject).toHaveBeenCalledTimes(2);
  });
});
```

### Test DLQ

```typescript
describe('DeadLetterQueue', () => {
  it('should move to DLQ after max retries', async () => {
    // Given
    const maxRetries = 3;
    const mockDlqService = {
      add: vi.fn().mockResolvedValue('dlq-msg-id'),
      getMessages: vi.fn().mockResolvedValue([]),
      requeue: vi.fn(),
      purge: vi.fn(),
    };

    const message = createMockMessage({
      id: '1706123456789-0',
      data: { orderId: 'order-123' },
      attempt: maxRetries + 1,  // Exceeded max retries
    });

    // When
    await processor.handle(message);

    // Then - message rejected, DLQ service handles storage
    expect(message.reject).toHaveBeenCalled();
  });
});
```

## Test Utilities

```typescript
// test/helpers/stream.helper.ts
export class StreamTestHelper {
  static async createTestStream(
    redis: Redis,
    stream: string,
    count: number
  ): Promise<void> {
    for (let i = 0; i < count; i++) {
      await redis.xadd(stream, '*', 'data', JSON.stringify({ id: i }));
    }
  }

  static async clearStream(redis: Redis, stream: string): Promise<void> {
    await redis.del(stream);
    await redis.del(`${stream}:dlq`);
  }

  static async waitForConsumption(
    consumer: IStreamConsumer,
    stream: string,
    group: string,
    targetPending: number = 0,
    timeoutMs: number = 5000
  ): Promise<void> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const pending = await consumer.getPending(stream, group);

      if (pending.count === targetPending) {
        return;
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    throw new Error('Timeout waiting for consumption');
  }
}
```

## Testing Best Practices

**1. Clean up after tests:**

```typescript
afterEach(async () => {
  await redis.del('test-stream');
  await redis.del('test-stream:dlq');
});
```

**2. Use descriptive test data:**

```typescript
// ✅ Good
const order = { orderId: 'test-order-123', total: 100 };

// ❌ Bad
const order = { id: 'abc', value: 1 };
```

**3. Test error scenarios:**

```typescript
it('should handle Redis connection failure', async () => {
  mockProducer.publish.mockRejectedValue(new Error('Connection refused'));
  // Test graceful degradation
});
```

**4. Test concurrent processing:**

```typescript
it('should handle concurrent messages', async () => {
  const messages = Array(10).fill(null).map((_, i) =>
    createMockMessage({ id: `msg-${i}`, data: { orderId: `order-${i}` } })
  );

  await Promise.all(messages.map(msg => processor.handle(msg)));

  expect(processedCount).toBe(10);
});
```

**5. Mock external dependencies:**

```typescript
// Mock external services
const mockEmailService = {
  send: vi.fn().mockResolvedValue(undefined),
};

const mockPaymentGateway = {
  charge: vi.fn().mockResolvedValue({ id: 'charge-123' }),
};
```

## Next Steps

- [Recipes](./recipes) — Real-world examples
- [Troubleshooting](./troubleshooting) — Debug test failures
