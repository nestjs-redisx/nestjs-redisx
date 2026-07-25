---
title: 'Testing Guide — Pub/Sub Plugin | NestJS RedisX'
description: 'Test NestJS Pub/Sub code without Redis: the in-memory driver ships a process-wide Pub/Sub bus spanning publisher and subscriber clients.'
---

# Testing

## In-memory driver (no Redis)

`@nestjs-redisx/testing` implements Pub/Sub on a process-wide in-memory bus, so the REAL plugin — including its dedicated subscriber connection — round-trips messages hermetically:

```typescript
import { Test } from '@nestjs/testing';
import { RedisTestingModule } from '@nestjs-redisx/testing';
import { PubSubPlugin, PUBSUB_SERVICE, IPubSubService } from '@nestjs-redisx/pubsub';
import { describe, it, expect } from 'vitest';

describe('pubsub (in-memory)', () => {
  it('round-trips a message', async () => {
    const app = await Test.createTestingModule({
      imports: [RedisTestingModule.forRoot({ plugins: [new PubSubPlugin()] })],
    }).compile();
    await app.init();

    const pubsub = app.get<IPubSubService>(PUBSUB_SERVICE);
    const got: unknown[] = [];
    await pubsub.subscribe('events', (msg) => got.push(msg.data));

    await pubsub.publish('events', { n: 1 });
    await new Promise((r) => setTimeout(r, 20));

    expect(got).toEqual([{ n: 1 }]);
    await app.close();
  });
});
```

## Mocking the service

For pure unit tests, stub `PUBSUB_SERVICE`:

```typescript
const pubsub: Partial<IPubSubService> = {
  publish: vi.fn().mockResolvedValue(1),
  subscribe: vi.fn().mockResolvedValue({ target: 'x', isPattern: false, unsubscribe: vi.fn() }),
};
```
