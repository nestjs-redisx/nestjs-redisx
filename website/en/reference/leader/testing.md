---
title: 'Testing - Leader Election Plugin | NestJS RedisX'
description: 'Testing leader-gated code: the in-memory driver for full-stack tests without Redis, faking leadership in unit tests, and multi-instance simulation.'
---

# Testing

## Full Stack Without Redis

The plugin runs completely on the [in-memory driver](../testing/) - CAS Lua scripts included:

```typescript
import { Test } from '@nestjs/testing';
import { RedisModule } from '@nestjs-redisx/core';
import { MEMORY_DRIVER_TYPE } from '@nestjs-redisx/testing';
import { LeaderPlugin, LEADER_SERVICE, type ILeaderService } from '@nestjs-redisx/leader';

const app = await Test.createTestingModule({
  imports: [
    RedisModule.forRoot({
      clients: { type: 'single', host: 'unused', port: 1 },
      global: { driver: MEMORY_DRIVER_TYPE },
      plugins: [new LeaderPlugin({ ttlMs: 500, renewIntervalMs: 100, retryIntervalMs: 100 })],
    }),
  ],
}).compile();
await app.init();

const leader = app.get<ILeaderService>(LEADER_SERVICE);
expect(leader.isLeader()).toBe(true); // the single instance leads right after init
```

The first election round is awaited during `onModuleInit`, so leadership is deterministic by the time `app.init()` resolves - no sleeps needed for the single-instance case.

## Simulating a Second Instance

Two competing "instances" are two `LeaderService` objects over the same store:

```typescript
import { LeaderService, LEADER_STORE, type ILeaderStore } from '@nestjs-redisx/leader';

const nodeB = new LeaderService(
  { ttlMs: 500, renewIntervalMs: 100, retryIntervalMs: 100, instanceId: 'node-b' },
  app.get<ILeaderStore>(LEADER_STORE),
);
await nodeB.onModuleInit();

expect(nodeB.isLeader()).toBe(false); // the app instance already leads

await app.get<ILeaderService>(LEADER_SERVICE).stepDown();
await new Promise((r) => setTimeout(r, 300));
expect(nodeB.isLeader()).toBe(true); // failover

await nodeB.onModuleDestroy(); // always stop manual instances
```

## Unit Testing Leader-Gated Services

For plain unit tests, don't run elections at all - the decorator resolves the service through a lazy getter you can point at a stub:

```typescript
import { registerLeaderServiceGetter } from '@nestjs-redisx/leader';

beforeEach(() => {
  registerLeaderServiceGetter(() => ({ isLeader: () => true })); // this test IS the leader
});

afterEach(() => {
  registerLeaderServiceGetter(null); // back to fail-safe skip
});
```

With no getter registered, `@LeaderOnly` methods skip (resolve to `undefined`) - which is also worth asserting for the follower path.

## Timing Guidance

- Use small `ttlMs`/`renewIntervalMs`/`retryIntervalMs` (hundreds of ms) and real waits in integration tests; the loop reads `Date.now()`.
- Keep `renewIntervalMs < ttlMs` even in tests - validation is fail-fast.

## Next Steps

- [Testing utilities](../testing/) - the in-memory driver reference
- [Recipes](./recipes) - patterns worth covering with tests
