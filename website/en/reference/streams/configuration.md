---
title: 'Configuration Reference — Streams Plugin | NestJS RedisX'
description: 'Configure StreamsPlugin client, keyPrefix, consumer batchSize, blockTimeout, dedicated Redis connections, and DLQ options in NestJS forRootAsync setups.'
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
   * Idle time before claiming messages (ms).
   *
   * Drives the background auto-claim loop: every `claimIdleTimeout` ms each
   * consumer scans the group's pending entries (XPENDING) and reclaims (XCLAIM)
   * any message idle for at least this long — e.g. messages left pending by a
   * crashed consumer — then processes them through the normal handler/retry/DLQ
   * path. Set to 0 to disable auto-claim. The `claimIdle()` method remains
   * available for on-demand claiming.
   * @default 30000
   */
  claimIdleTimeout?: number;
}
```

### Producer Options

```typescript
interface ProducerOptions {
  /**
   * Default maximum stream length used when no `trim` block is configured.
   * Every publish runs `XADD ... MAXLEN ~ <maxLen>` (approximate trimming).
   * @default 100000
   */
  maxLen?: number;

  /**
   * Implicitly create the stream on first publish. When false, publishes set
   * NOMKSTREAM so a publish to a missing stream is a no-op (returns null).
   * @default true
   */
  autoCreate?: boolean;
}
```

::: tip Disabling trimming (keep-all)
To retain every entry (for example for event sourcing), set `trim: { enabled:
false }` at the plugin level — no `MAXLEN` is then applied on publish. To cap the
stream, use the `trim` block (see below) or `producer.maxLen`. A per-publish
`maxLen` always overrides the configured trimming for that call.

The `autoCreate` option controls implicit stream creation on publish. When
`true` (default), the first `XADD` creates the stream as usual. When `false`,
publishes set `NOMKSTREAM`, so a publish to a non-existent stream does **not**
create it — the publish becomes a no-op returning `null` instead.
:::

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

### Trimming

```typescript
interface TrimOptions {
  /**
   * Whether to trim on publish. Set to false to keep all entries (event
   * sourcing). @default true
   */
  enabled?: boolean;

  /**
   * Maximum stream length. Falls back to producer.maxLen, then 100000.
   */
  maxLen?: number;

  /**
   * Approximate trimming (MAXLEN ~) for better performance. @default true
   */
  approximate?: boolean;

  /** Trimming strategy. Only MAXLEN is applied from config. */
  strategy?: 'MAXLEN' | 'MINID';
}
```

When a `trim` block is configured it controls trimming on every publish:

- `trim.enabled: false` disables trimming entirely (keep-all).
- `trim.maxLen` / `trim.approximate` set the `MAXLEN` and whether it is exact.
- Only the `MAXLEN` strategy is applied from config (`MINID` requires an id that
  is not part of the config).

When no `trim` block is set, trimming falls back to `producer.maxLen`. A
per-publish `maxLen` always overrides the configured trimming for that call. For
one-off trimming you can also call `producer.trim(stream, maxLen)` directly.

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
  },

  // Producer configuration (maxLen also controls trimming)
  producer: {
    maxLen: 500000,
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
    maxRetries: 10,      // Many retries before DLQ
  },
  dlq: {
    enabled: true,
    maxLen: 100000,      // Large DLQ
  },
})
```

::: tip Event sourcing / keep-all
For event sourcing where every entry must be retained, disable trimming:

```typescript
new StreamsPlugin({
  trim: { enabled: false }, // keep-all: no MAXLEN applied on publish
})
```
:::

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
