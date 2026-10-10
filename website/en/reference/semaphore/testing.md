---
title: 'Testing Semaphores | NestJS RedisX'
description: 'Run real semaphore elections on the in-memory driver - Lua scripts included, no Redis required.'
---

# Testing

The plugin runs unchanged on the [in-memory testing driver](/en/reference/testing/) - the acquire/extend/release Lua scripts execute on the interpreter byte-for-byte, so your tests exercise production code paths with **no Redis**.

```typescript
import { Test } from '@nestjs/testing';
import { RedisTestingModule } from '@nestjs-redisx/testing';
import { SemaphorePlugin, SEMAPHORE_SERVICE, type ISemaphoreService } from '@nestjs-redisx/semaphore';

describe('BoundedWorker', () => {
  it('enforces the capacity', async () => {
    const app = await Test.createTestingModule({
      imports: [RedisTestingModule.forRoot({ plugins: [new SemaphorePlugin()] })],
    }).compile();
    await app.init();

    const semaphore = app.get<ISemaphoreService>(SEMAPHORE_SERVICE);

    const p1 = await semaphore.acquire('jobs', 2);
    const p2 = await semaphore.acquire('jobs', 2);
    expect(await semaphore.tryAcquire('jobs', 2)).toBeNull(); // full

    await p1.release();
    expect(await semaphore.tryAcquire('jobs', 2)).not.toBeNull(); // seat freed

    await app.close();
  });
});
```

## Simulating a Second Instance

Construct a second `SemaphoreService` over the **same store** to model another replica competing for seats:

```typescript
import { SemaphoreService, SEMAPHORE_STORE, type ISemaphoreStore } from '@nestjs-redisx/semaphore';

const nodeB = new SemaphoreService(
  { retry: { maxRetries: 0, initialDelay: 10, maxDelay: 10, multiplier: 1 }, autoRenew: { enabled: false } },
  app.get<ISemaphoreStore>(SEMAPHORE_STORE),
);

await semaphoreA.acquire('jobs', 1);
expect(await nodeB.tryAcquire('jobs', 1)).toBeNull(); // the other replica is blocked
```

## Testing Crash Recovery

Acquire with a short TTL and auto-renewal off, never release, and wait the TTL out - the seat frees itself:

```typescript
await semaphore.acquire('crashy', 1, { ttl: 100, autoRenew: false });
await new Promise((r) => setTimeout(r, 150));
expect(await semaphore.tryAcquire('crashy', 1)).not.toBeNull();
```
