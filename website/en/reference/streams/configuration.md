---
title: Configuration
description: Streams plugin configuration reference
---

# Configuration

Configure the Streams plugin.

## Basic Configuration

<<< @/apps/demo/src/plugins/streams/basic-config.setup.ts{typescript}

## Async Configuration

Using `process.env` directly in plugin constructor with `forRootAsync`:

<<< @/apps/demo/src/plugins/streams/async-config.setup.ts{typescript}

### Using registerAsync with ConfigService

For type-safe configuration via NestJS DI:

<<< @/apps/demo/src/plugins/streams/register-async.setup.ts{typescript}

## Dedicated Redis Client

`XREADGROUP BLOCK` holds the connection for the full `blockTimeout` duration. If Streams shares a connection with cache, locks, or rate limiting, blocking commands can trigger `commandTimeout` errors on the shared connection. A dedicated client with a higher `commandTimeout` isolates blocking commands from the rest of your application.

<<< @/apps/demo/src/plugins/streams/dedicated-client.setup.ts{typescript}

::: warning Timeout Configuration
When using a shared connection (no `client` option), ensure `commandTimeout > blockTimeout` in your Redis config. Otherwise XREADGROUP will timeout before it can return results. Using a dedicated client is the recommended approach.
:::

## Configuration Options

### Plugin Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `client` | `string` | `'default'` | Named Redis client to use. Configure clients in `RedisModule.forRoot({ clients: { ... } })`. Use a dedicated client for Streams to avoid blocking the shared connection. |
| `keyPrefix` | `string` | `'stream:'` | Prefix for all stream keys |

### Consumer Options

```typescript
interface ConsumerOptions {
  /**
   * Messages per batch
   * @default 10
   */
  batchSize?: number;

  /**
   * Block timeout when waiting for messages (ms)
   * @default 5000
   */
  blockTimeout?: number;

  /**
   * Maximum concurrent message processing
   * @default 1
   */
  concurrency?: number;

  /**
   * Maximum retry attempts before DLQ
   * @default 3
   */
  maxRetries?: number;

  /**
   * Idle time before claiming messages (ms)
   * @default 30000
   */
  claimIdleTimeout?: number;
}
```

### Producer Options

```typescript
interface ProducerOptions {
  /**
   * Maximum stream length (auto-trim)
   * @default 100000
   */
  maxLen?: number;

  /**
   * Auto-create stream on first publish
   * @default true
   */
  autoCreate?: boolean;
}
```

### Dead Letter Queue Options

```typescript
interface DLQOptions {
  /**
   * Enable Dead Letter Queue
   * @default true
   */
  enabled?: boolean;

  /**
   * DLQ stream suffix
   * @default ':dlq'
   */
  streamSuffix?: string;

  /**
   * Maximum DLQ stream length
   * @default 10000
   */
  maxLen?: number;
}
```

### Retry Options

::: info
When a message is rejected and `attempt < maxRetries`, the library waits using exponential backoff (`initialDelay × multiplier^(attempt-1)`, capped at `maxDelay`), then re-adds the message to the stream with `_attempt` incremented. See [Message Handling](./message-handling) for details.
:::

```typescript
interface RetryOptions {
  /**
   * Maximum retry attempts
   * @default 3
   */
  maxRetries?: number;

  /**
   * Initial backoff delay (ms)
   * @default 1000
   */
  initialDelay?: number;

  /**
   * Maximum backoff delay (ms)
   * @default 30000
   */
  maxDelay?: number;

  /**
   * Backoff multiplier
   * @default 2
   */
  multiplier?: number;
}
```

### Trim Options

```typescript
interface TrimOptions {
  /**
   * Enable auto-trimming
   * @default true
   */
  enabled?: boolean;

  /**
   * Maximum stream length
   * @default 100000
   */
  maxLen?: number;

  /**
   * Trim strategy
   * @default 'MAXLEN'
   */
  strategy?: 'MAXLEN' | 'MINID';

  /**
   * Use approximate trimming (~)
   * @default true
   */
  approximate?: boolean;
}
```

## Full Configuration Example

```typescript
new StreamsPlugin({
  // Use dedicated Redis client for blocking commands
  client: 'streams',

  // Consumer configuration
  consumer: {
    batchSize: 50,
    blockTimeout: 10000,
    concurrency: 5,
    maxRetries: 5,
    claimIdleTimeout: 60000,
  },

  // Producer configuration
  producer: {
    maxLen: 500000,
    autoCreate: true,
  },

  // Dead Letter Queue
  dlq: {
    enabled: true,
    streamSuffix: ':failed',
    maxLen: 50000,
  },

  // Retry backoff
  retry: {
    maxRetries: 5,
    initialDelay: 2000,
    maxDelay: 30000,
    multiplier: 3,
  },

  // Stream trimming
  trim: {
    enabled: true,
    maxLen: 500000,
    strategy: 'MAXLEN',
    approximate: true,
  },
})
```

## Retry Behavior

When a message handler fails and `attempt < maxRetries`, the library applies exponential backoff and re-adds the message to the stream with `_attempt` incremented. After `maxRetries` failures, the message moves to DLQ. Use `claimIdle()` separately for recovering orphaned messages (e.g., consumer crashed without ACK):

```typescript
new StreamsPlugin({
  consumer: {
    maxRetries: 3,              // Max attempts before DLQ
  },
  retry: {
    initialDelay: 1000,         // First retry delay: 1s
    maxDelay: 30000,            // Cap at 30s
    multiplier: 2,              // Double each attempt
  },
})
```

See [Message Handling](./message-handling) for details on the retry lifecycle.

## Presets

### High Throughput

```typescript
new StreamsPlugin({
  consumer: {
    batchSize: 100,      // Large batches
    concurrency: 20,     // High parallelism
    blockTimeout: 1000,  // Quick checks
  },
  producer: {
    maxLen: 1000000,     // Large stream
  },
})
```

### Low-Latency Processing

```typescript
new StreamsPlugin({
  consumer: {
    batchSize: 1,        // Single message
    concurrency: 10,
    blockTimeout: 100,   // Very short wait
  },
})
```

### Reliable Processing

```typescript
new StreamsPlugin({
  consumer: {
    maxRetries: 10,           // Many retries before DLQ
    claimIdleTimeout: 60000,  // Long idle before claim
  },
  dlq: {
    enabled: true,
    maxLen: 100000,      // Large DLQ
  },
})
```

### Event Sourcing

```typescript
new StreamsPlugin({
  trim: {
    enabled: false,      // Keep all events!
  },
  producer: {
    maxLen: 0,           // No limit
  },
})
```

## Environment Configuration

```typescript
// config/streams.config.ts
import { registerAs } from '@nestjs/config';

export default registerAs('streams', () => ({
  consumer: {
    batchSize: parseInt(process.env.STREAMS_BATCH_SIZE || '10', 10),
    concurrency: parseInt(process.env.STREAMS_CONCURRENCY || '1', 10),
    maxRetries: parseInt(process.env.STREAMS_MAX_RETRIES || '3', 10),
  },
  dlq: {
    enabled: process.env.STREAMS_DLQ_ENABLED !== 'false',
  },
}));
```

```bash
# .env
STREAMS_BATCH_SIZE=20
STREAMS_CONCURRENCY=5
STREAMS_MAX_RETRIES=5
STREAMS_DLQ_ENABLED=true
```

## Next Steps

- [Producer](./producer) — Publishing messages
- [Consumer](./consumer) — Consuming messages
