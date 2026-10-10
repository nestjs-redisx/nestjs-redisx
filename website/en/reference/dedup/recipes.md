---
title: 'Dedup Recipes | NestJS RedisX'
description: 'Webhook redelivery, at-least-once queue consumers, double-click guards, and collapsing bursts with distributed debounce.'
---

# Recipes

## Webhook Redelivery

Providers (Stripe, GitHub, Shopify) redeliver on timeouts. Key by the provider's event id over the redelivery horizon:

<<< @/apps/demo/src/plugins/dedup/decorator.usage.ts{typescript}

## At-Least-Once Queue Consumers

SQS/RabbitMQ redeliveries carry the same message id — gate the handler:

```typescript
async handleMessage(msg: QueueMessage) {
  await this.dedup.dedupe(`queue:${msg.id}`, () => this.process(msg), {
    window: 15 * 60_000, // ≥ visibility timeout × max receives
  });
}
```

A thrown `process()` releases the marker, so the queue's redrive actually retries.

## Double-Click / Double-Submit Guard

```typescript
@Dedupe({ key: (userId, action) => `ui:${String(userId)}:${String(action)}`, window: 3_000 })
async performAction(userId: string, action: string) { /* one per 3s per user+action */ }
```

For *response replay* on retried HTTP requests, use [idempotency](/en/reference/idempotency/) instead.

## Collapsing Bursts (Distributed Debounce)

A hundred product updates in a minute should trigger one index rebuild — after the burst, wherever the last update landed:

<<< @/apps/demo/src/plugins/dedup/debounce.usage.ts{typescript}

## Manual Steering

When the flow needs the boolean rather than a wrapped function:

<<< @/apps/demo/src/plugins/dedup/service.usage.ts{typescript}
