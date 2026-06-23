---
title: 'Testing Plugins — Testing Utilities | NestJS RedisX'
description: 'Patterns for unit-testing the cache, locks, rate-limit, and idempotency plugins against the in-memory Redis driver, plus seeding and inspecting keyspace state.'
---

# Testing Plugins

Because the plugins are driver-agnostic, the same code you ship runs against the
in-memory driver. The examples below boot a Nest context with
`RedisTestingModule` and assert on real service behavior.

## Cache

`getOrSet` invokes the loader once and serves the cached value afterwards:

<<< @/apps/demo/src/plugins/testing/bootstrap-and-assert.usage.ts{typescript}

A typical Vitest spec wrapping that pattern:

```typescript
import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { RedisTestingModule } from '@nestjs-redisx/testing';
import { CachePlugin, CACHE_SERVICE, ICacheService } from '@nestjs-redisx/cache';

describe('cache (in-memory)', () => {
  it('serves from cache on the second call', async () => {
    const app = await Test.createTestingModule({
      imports: [RedisTestingModule.forRoot({ plugins: [new CachePlugin()] })],
    }).compile();
    await app.init();

    const cache = app.get<ICacheService>(CACHE_SERVICE);
    let calls = 0;
    const loader = async () => (calls++, { id: 1 });

    await cache.getOrSet('user:1', loader, { ttl: 60 });
    await cache.getOrSet('user:1', loader, { ttl: 60 });

    expect(calls).toBe(1);
    await app.close();
  });
});
```

## Locks

The lock release path uses an owner-checked Lua script, which the interpreter
runs faithfully — a second `tryAcquire` while held returns `null`:

```typescript
const app = await Test.createTestingModule({
  imports: [RedisTestingModule.forRoot({ plugins: [new LocksPlugin()] })],
}).compile();
await app.init();

const locks = app.get<ILockService>(LOCK_SERVICE);
const lock = await locks.acquire('order:1', { ttl: 5000 });
expect(await locks.tryAcquire('order:1', { ttl: 5000 })).toBeNull();
await lock.release();
```

## Rate limit

Token-bucket / sliding-window / fixed-window all run their real Lua scripts.
With a 2-point bucket, the third request is blocked:

```typescript
const app = await Test.createTestingModule({
  imports: [
    RedisTestingModule.forRoot({
      plugins: [new RateLimitPlugin({ defaultAlgorithm: 'token-bucket', defaultPoints: 2, defaultDuration: 60 })],
    }),
  ],
}).compile();
await app.init();

const rl = app.get<IRateLimitService>(RATE_LIMIT_SERVICE);
expect((await rl.check('ip:1')).allowed).toBe(true);
expect((await rl.check('ip:1')).allowed).toBe(true);
expect((await rl.check('ip:1')).allowed).toBe(false);
```

## Idempotency

Register `IdempotencyPlugin` the same way and inject `IDEMPOTENCY_SERVICE`; the
fingerprint store and TTLs behave exactly as they do against Redis.

## Streams

The in-memory driver implements stream consumer groups (delivery cursors, PEL,
`XACK`, `XCLAIM`, `XPENDING`), so the real producer and the background consumer
loop round-trip a message with no Redis:

<<< @/apps/demo/src/plugins/testing/streams.usage.ts{typescript}

A Vitest spec driving the producer and consumer group directly:

```typescript
import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { RedisTestingModule } from '@nestjs-redisx/testing';
import { StreamsPlugin, STREAM_PRODUCER, STREAM_CONSUMER, IStreamProducer, IStreamConsumer } from '@nestjs-redisx/streams';

describe('streams (in-memory)', () => {
  it('delivers a published message to the consumer group', async () => {
    const app = await Test.createTestingModule({
      imports: [RedisTestingModule.forRoot({ plugins: [new StreamsPlugin()] })],
    }).compile();
    await app.init();

    const producer = app.get<IStreamProducer>(STREAM_PRODUCER);
    const consumer = app.get<IStreamConsumer>(STREAM_CONSUMER);

    const received: Array<{ n: number }> = [];
    const done = new Promise<void>((resolve) => {
      consumer.consume<{ n: number }>('orders', 'g1', 'c1', async (msg) => {
        received.push(msg.data);
        resolve();
      });
    });

    await producer.publish('orders', { n: 1 });
    await done;

    expect(received).toEqual([{ n: 1 }]);
    await app.close();
  });
});
```

::: tip
The in-memory driver does not truly block: a `BLOCK` `XREADGROUP` with no new
messages returns promptly, so the consumer poll loop stays responsive in tests
instead of waiting the full block timeout.
:::

## Seeding and inspecting state

For tests that need to pre-populate the keyspace or assert on raw values, cast
the injected driver to `MemoryRedisAdapter` and use `getStore()`:

<<< @/apps/demo/src/plugins/testing/seed-and-inspect.usage.ts{typescript}

`getStore()` returns the in-memory `MemoryStore`, which exposes `writeString`,
`read`, `flush`, `keys`, and TTL helpers — handy for arranging and resetting
state between cases.
