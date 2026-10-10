---
title: 'Testing Counters | NestJS RedisX'
description: 'Exercise atomic counters, window TTLs, and sequences on the in-memory driver - no Redis required.'
---

# Testing

The plugin runs unchanged on the [in-memory testing driver](/en/reference/testing/) - including the window-TTL and read-and-reset Lua scripts.

```typescript
import { Test } from '@nestjs/testing';
import { RedisTestingModule } from '@nestjs-redisx/testing';
import { CountersPlugin, COUNTER_SERVICE, type ICounterService } from '@nestjs-redisx/counters';

describe('StatsService', () => {
  it('never loses concurrent increments', async () => {
    const app = await Test.createTestingModule({
      imports: [RedisTestingModule.forRoot({ plugins: [new CountersPlugin()] })],
    }).compile();
    await app.init();

    const counters = app.get<ICounterService>(COUNTER_SERVICE);

    await Promise.all(Array.from({ length: 50 }, () => counters.increment('hits')));
    expect(await counters.get('hits')).toBe(50);

    expect(await counters.getAndReset('hits')).toBe(50); // atomic flush
    expect(await counters.get('hits')).toBe(0);

    await app.close();
  });
});
```

## Testing Window Expiry

Short TTLs with real timers:

```typescript
await counters.increment('win', 1, { ttl: 100 });
await new Promise((r) => setTimeout(r, 140));
expect(await counters.get('win')).toBe(0); // expired with its first write
```

## Testing Sequences Across "Instances"

```typescript
import { CounterService, COUNTER_STORE, type ICounterStore } from '@nestjs-redisx/counters';

const nodeB = new CounterService({}, app.get<ICounterStore>(COUNTER_STORE));
const values = await Promise.all([counters.next('seq'), nodeB.next('seq'), counters.next('seq')]);
expect([...values].sort()).toEqual([1, 2, 3]); // unique and monotonic
```
