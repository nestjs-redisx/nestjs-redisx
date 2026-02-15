---
title: Consumer API
description: Consuming messages from Redis Streams with decorators and service
---

# Consumer API

Consume and process messages from streams.

## @StreamConsumer Decorator

The easiest way to consume messages:

<<< @/apps/demo/src/plugins/streams/service-consume.usage.ts{typescript}

## Decorator Options

```typescript
interface StreamConsumerOptions {
  /**
   * Stream name
   */
  stream: string;

  /**
   * Consumer group name
   */
  group: string;

  /**
   * Consumer name (default: hostname-pid)
   */
  consumer?: string;

  /**
   * Messages per batch
   * @default 10
   */
  batchSize?: number;

  /**
   * Block timeout (ms)
   * @default 5000
   */
  blockTimeout?: number;

  /**
   * Max retries before DLQ
   * @default 3
   */
  maxRetries?: number;

  /**
   * Concurrent processing
   * @default 1
   */
  concurrency?: number;
}
```

## IStreamMessage Interface

```typescript
interface IStreamMessage<T> {
  /**
   * Message ID (timestamp-sequence)
   */
  readonly id: string;

  /**
   * Stream name
   */
  readonly stream: string;

  /**
   * Message data
   */
  readonly data: T;

  /**
   * Current attempt (1-based)
   */
  readonly attempt: number;

  /**
   * Message timestamp
   */
  readonly timestamp: Date;

  /**
   * Acknowledge success
   */
  ack(): Promise<void>;

  /**
   * Reject (retry or DLQ)
   */
  reject(error?: Error): Promise<void>;
}
```

## Message Handling

### Success Path

```typescript
@StreamConsumer({ stream: 'orders', group: 'processors' })
async handle(message: IStreamMessage<Order>): Promise<void> {
  // Process
  await this.processOrder(message.data);

  // Acknowledge success
  await message.ack();
}
```

### Error Path

```typescript
@StreamConsumer({ stream: 'orders', group: 'processors' })
async handle(message: IStreamMessage<Order>): Promise<void> {
  try {
    await this.processOrder(message.data);
    await message.ack();
  } catch (error) {
    // Will retry or move to DLQ
    await message.reject(error);
  }
}
```

### Conditional Retry

```typescript
@StreamConsumer({ stream: 'orders', group: 'processors', maxRetries: 5 })
async handle(message: IStreamMessage<Order>): Promise<void> {
  try {
    await this.processOrder(message.data);
    await message.ack();
  } catch (error) {
    if (this.isTransientError(error)) {
      // Transient error - will retry
      console.log(`Attempt ${message.attempt}/5 failed, will retry`);
      await message.reject(error);
    } else {
      // Permanent error - skip retries, go to DLQ
      console.error('Permanent error, moving to DLQ');
      await message.reject(error);
    }
  }
}
```

## Manual Consumer Service

For more control, use the service directly:

<<< @/apps/demo/src/plugins/streams/service-consumer-manual.usage.ts{typescript}

## Consumer Service Methods

### createGroup()

Create a consumer group:

```typescript
await consumer.createGroup(
  'orders',      // Stream
  'processors',  // Group name
  '0'            // Start ID: '0' = beginning, '$' = new only
);
```

### consume()

Start consuming messages:

```typescript
const handle = consumer.consume(
  'orders',      // Stream
  'processors',  // Group
  'worker-1',    // Consumer name
  handler,       // Message handler
  options        // ConsumeOptions
);
```

### stop()

Stop a consumer:

```typescript
await consumer.stop(handle);
```

### getPending()

Get pending messages info:

```typescript
const pending = await consumer.getPending('orders', 'processors');

console.log({
  count: pending.count,
  minId: pending.minId,
  maxId: pending.maxId,
  consumers: pending.consumers,
});
```

### claimIdle()

Claim idle messages from dead consumers:

```typescript
const claimed = await consumer.claimIdle(
  'orders',
  'processors',
  'worker-1',
  30000,  // Min idle time (ms)
);
// Returns: IStreamMessage<T>[]
```

## Multiple Consumers

### Same Group (Load Balancing)

Messages distributed between consumers:

```typescript
// Consumer 1
@StreamConsumer({ stream: 'orders', group: 'processors', consumer: 'worker-1' })
async handle1(message: IStreamMessage<Order>) { }

// Consumer 2
@StreamConsumer({ stream: 'orders', group: 'processors', consumer: 'worker-2' })
async handle2(message: IStreamMessage<Order>) { }
```

### Different Groups (Fan-out)

Each group gets all messages:

```typescript
// Processing group
@StreamConsumer({ stream: 'orders', group: 'processors' })
async process(message: IStreamMessage<Order>) { }

// Analytics group
@StreamConsumer({ stream: 'orders', group: 'analytics' })
async analyze(message: IStreamMessage<Order>) { }

// Notifications group
@StreamConsumer({ stream: 'orders', group: 'notifications' })
async notify(message: IStreamMessage<Order>) { }
```

## Next Steps

- [Consumer Groups](./consumer-groups) — Group coordination
- [Message Handling](./message-handling) — ACK/NACK details
