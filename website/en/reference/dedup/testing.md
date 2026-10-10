---
title: 'Testing Dedup | NestJS RedisX'
description: 'Exercise first-wins markers, failure re-admission, and distributed debounce on the in-memory driver - no Redis.'
---

# Testing

The plugin runs unchanged on the [in-memory testing driver](/en/reference/testing/) - `SET NX PX` and the CAS Lua scripts execute through production code with **no Redis**.

```typescript
import { Test } from '@nestjs/testing';
import { RedisTestingModule } from '@nestjs-redisx/testing';
import { DedupPlugin, DEDUP_SERVICE, type IDedupService } from '@nestjs-redisx/dedup';

describe('WebhookService', () => {
  it('handles each event id once', async () => {
    const app = await Test.createTestingModule({
      imports: [RedisTestingModule.forRoot({ plugins: [new DedupPlugin()] })],
    }).compile();
    await app.init();

    const dedup = app.get<IDedupService>(DEDUP_SERVICE);
    let handled = 0;

    await Promise.all(
      Array.from({ length: 5 }, () => dedup.dedupe('evt:1', async () => void handled++)),
    );

    expect(handled).toBe(1); // concurrent duplicates admitted exactly one

    await app.close();
  });
});
```

## Testing Failure Re-Admission

```typescript
await expect(
  dedup.dedupe('evt:2', async () => { throw new Error('transient'); }),
).rejects.toThrow('transient');

// the failed first released its marker - the retry runs
expect(await dedup.dedupe('evt:2', async () => 'retried')).toBe('retried');
```

## Testing Window Expiry

Use a short per-call window and real timers:

```typescript
expect(await dedup.isFirst('k', { window: 100 })).toBe(true);
expect(await dedup.isFirst('k', { window: 100 })).toBe(false);
await new Promise((r) => setTimeout(r, 140));
expect(await dedup.isFirst('k', { window: 100 })).toBe(true); // new window
```

## Simulating a Second Instance

```typescript
import { DedupService, DEDUP_STORE, type IDedupStore } from '@nestjs-redisx/dedup';

const nodeB = new DedupService({}, app.get<IDedupStore>(DEDUP_STORE));
const [a, b] = await Promise.all([dedupA.isFirst('race'), nodeB.isFirst('race')]);
expect([a, b].filter(Boolean)).toHaveLength(1); // exactly one winner
```
