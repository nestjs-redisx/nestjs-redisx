# @nestjs-redisx/dedup

Event deduplication and distributed debounce plugin for [NestJS RedisX](https://nestjs-redisx.dev) — run webhooks, queue messages, and user actions **once per window across the fleet**, with first-wins TTL markers and a trailing debounce.

## Why

Webhook providers redeliver. Queues are at-least-once. Users double-click. A lightweight "have I seen this key in the last N seconds?" check — atomic across every instance — removes the whole class of duplicate side effects without the weight of full request idempotency.

- **First-wins markers** — `SET NX PX` under the hood: exactly one winner per key per window, fleet-wide.
- **Failures don't burn the window** — when the first execution throws, its marker is released (CAS on the owner token), so a retry isn't locked out until the TTL.
- **Distributed trailing debounce** — the function runs once the key goes quiet, on the instance that made the LAST call.
- **`@Dedupe`** — proxy-based decorator for any `@Injectable` method with `{n}` key templates.
- **`errorPolicy`** — gates fail open (default, duplicates possible during an outage) or closed (skip + throw); manual APIs are always strict.

Deduplication here is a lightweight marker — nothing is stored or replayed. For request-grade idempotency with fingerprints and response replay, use [`@nestjs-redisx/idempotency`](https://nestjs-redisx.dev/en/reference/idempotency/).

## Install

```bash
npm install @nestjs-redisx/core @nestjs-redisx/dedup ioredis
```

## Quick start

```typescript
import { Module, Injectable } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { DedupPlugin, Dedupe } from '@nestjs-redisx/dedup';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: { type: 'single', host: 'localhost', port: 6379 },
      plugins: [new DedupPlugin({ defaultWindow: 60_000 })],
    }),
  ],
})
export class AppModule {}

@Injectable()
export class WebhookService {
  // Each Stripe event id is handled once per 5 minutes, fleet-wide
  @Dedupe({ key: 'stripe:{0}', window: 300_000 })
  async handleEvent(eventId: string, payload: unknown) {
    // ...
  }
}
```

Service API:

```typescript
import { Inject, Injectable } from '@nestjs/common';
import { DEDUP_SERVICE, type IDedupService } from '@nestjs-redisx/dedup';

@Injectable()
export class EventsService {
  constructor(@Inject(DEDUP_SERVICE) private readonly dedup: IDedupService) {}

  async onOrderCreated(orderId: string) {
    // exactly one confirmation email per order per window
    await this.dedup.dedupe(`order-created:${orderId}`, () => this.sendConfirmation(orderId));
  }

  async onProductChanged() {
    // rebuild the index once per quiet minute, on the last-calling instance
    await this.dedup.debounce('reindex:products', () => this.rebuildIndex(), { window: 60_000 });
  }
}
```

## Documentation

Full reference: <https://nestjs-redisx.dev/en/reference/dedup/>

## License

MIT
