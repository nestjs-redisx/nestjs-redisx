---
title: Producer API
description: Publishing messages to Redis Streams
---

# Producer API

Publish messages to streams.

## Inject Producer

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { STREAM_PRODUCER, IStreamProducer } from '@nestjs-redisx/streams';

@Injectable()
export class OrderService {
  constructor(
    @Inject(STREAM_PRODUCER) private readonly producer: IStreamProducer,
  ) {}
}
```

## Methods Overview

| Method | Description | Returns |
|--------|-------------|---------|
| `publish()` | Publish single message | Message ID |
| `publishBatch()` | Publish multiple messages | Message IDs |
| `getStreamInfo()` | Get stream metadata | StreamInfo |
| `trim()` | Remove old messages | number (trimmed count) |

## publish()

Publish a single message:

```typescript
async publish<T>(
  stream: string,
  data: T,
  options?: PublishOptions
): Promise<string>
```

### Basic Usage

```typescript
const messageId = await this.producer.publish('orders', {
  id: 'order-123',
  customerId: 'cust-456',
  total: 99.99,
});

console.log(`Published: ${messageId}`);
// Published: 1706123456789-0
```

### With Options

```typescript
const messageId = await this.producer.publish(
  'orders',
  { id: 'order-123' },
  {
    maxLen: 50000,  // Trim stream to 50K messages
  }
);
```

### PublishOptions

```typescript
interface PublishOptions {
  /**
   * Maximum stream length (approximate)
   */
  maxLen?: number;

  /**
   * Custom message ID (rarely needed)
   */
  id?: string;
}
```

## publishBatch()

Publish multiple messages efficiently:

```typescript
async publishBatch<T>(
  stream: string,
  messages: T[],
  options?: PublishOptions
): Promise<string[]>
```

### Usage

```typescript
const orders = [
  { id: 'order-1', total: 100 },
  { id: 'order-2', total: 200 },
  { id: 'order-3', total: 300 },
];

const messageIds = await this.producer.publishBatch('orders', orders);

console.log(messageIds);
// ['1706123456789-0', '1706123456789-1', '1706123456789-2']
```

### Performance

Batch publishing uses Redis pipeline:

```
Single publish (3 messages): 3 round trips
Batch publish (3 messages): 1 round trip
```

## getStreamInfo()

Get stream metadata:

```typescript
async getStreamInfo(stream: string): Promise<StreamInfo>
```

### Usage

```typescript
const info = await this.producer.getStreamInfo('orders');

console.log({
  length: info.length,           // 12345
  groups: info.groups,           // 2
  firstEntry: info.firstEntry,   // { id: '...', timestamp: Date }
  lastEntry: info.lastEntry,     // { id: '...', timestamp: Date }
});
```

### StreamInfo Interface

```typescript
interface StreamInfo {
  length: number;
  firstEntry?: {
    id: string;
    timestamp: Date;
  };
  lastEntry?: {
    id: string;
    timestamp: Date;
  };
  groups: number;
}
```

## trim()

Remove old messages:

```typescript
async trim(stream: string, maxLen: number): Promise<number>
```

### Usage

```typescript
// Keep only last 10,000 messages
const trimmed = await this.producer.trim('orders', 10000);
console.log(`Trimmed ${trimmed} messages`);
```

### Automatic Trimming

Use `maxLen` in publish options for automatic trimming:

```typescript
// Automatically trims while publishing
await this.producer.publish('orders', data, { maxLen: 100000 });
```

## Error Handling

```typescript
import { StreamPublishError } from '@nestjs-redisx/streams';

try {
  await this.producer.publish('orders', data);
} catch (error) {
  if (error instanceof StreamPublishError) {
    console.error('Publish failed:', error.message);
    console.error('Stream:', error.stream);

    // Retry or fallback
    await this.retryQueue.add(data);
  }
  throw error;
}
```

## Real-World Example

<<< @/apps/demo/src/plugins/streams/service-producer-full.usage.ts{typescript}

## Next Steps

- [Consumer](./consumer) — Consuming messages
- [Consumer Groups](./consumer-groups) — Group coordination
