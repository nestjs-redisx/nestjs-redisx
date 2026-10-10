# @nestjs-redisx/counters

Atomic counters and sequences plugin for [NestJS RedisX](https://nestjs-redisx.dev) - fleet-wide increments that never lose updates, window counters that expire on their own, and monotonic ID sequences.

## Why

`this.views++` loses updates the moment you run two replicas. Redis INCR is the canonical fix - this plugin wraps it with validated inputs, window TTL semantics that actually behave (first write opens the window, later writes never extend it), atomic read-and-reset for batch flushes, and loud failures on poisoned keys instead of silent `NaN`.

- **Atomic everywhere** - every mutation is one Redis operation; concurrent increments from any number of instances all count.
- **Window counters** - `increment(key, 1, { ttl })` applies the TTL only when the increment creates the key: `api:${userId}:${today}` cleans up after itself.
- **`getAndReset`** - read the accumulated total and zero it in one atomic step (periodic aggregation without double counting).
- **Sequences** - `next('seq:invoices')` issues 1, 2, 3… across the whole fleet.
- **Strict by design** - amounts must be non-zero safe integers; a counter key holding a non-numeric value throws `CounterValueError` instead of propagating `NaN` into your aggregates.

## Install

```bash
npm install @nestjs-redisx/core @nestjs-redisx/counters ioredis
```

## Quick start

```typescript
import { Module, Injectable, Inject } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { CountersPlugin, COUNTER_SERVICE, type ICounterService } from '@nestjs-redisx/counters';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: { type: 'single', host: 'localhost', port: 6379 },
      plugins: [new CountersPlugin()],
    }),
  ],
})
export class AppModule {}

@Injectable()
export class StatsService {
  constructor(@Inject(COUNTER_SERVICE) private readonly counters: ICounterService) {}

  async onArticleView(articleId: string) {
    // fleet-wide, never loses an update
    return this.counters.increment(`views:${articleId}`);
  }

  async onApiCall(userId: string) {
    // daily usage counter that expires on its own
    const today = new Date().toISOString().slice(0, 10);
    return this.counters.increment(`api:${userId}:${today}`, 1, { ttl: 86_400_000 });
  }

  async flushEmailBatchTotal() {
    // read and zero atomically - periodic aggregation without double counting
    return this.counters.getAndReset('emails:batch');
  }

  async nextInvoiceNumber() {
    return this.counters.next('seq:invoices');
  }
}
```

## Documentation

Full reference: <https://nestjs-redisx.dev/en/reference/counters/>

## License

MIT
