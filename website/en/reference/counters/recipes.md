---
title: 'Counters Recipes | NestJS RedisX'
description: 'Daily usage quotas, batch flush aggregation, live statistics, seat inventories, and fleet-wide ID generation.'
---

# Recipes

## Daily Usage Quota

Count per user per day; the key cleans itself up:

<<< @/apps/demo/src/plugins/counters/window.usage.ts{typescript}

Quota check at the call site:

```typescript
const used = await this.counters.increment(`api:${userId}:${today}`, 1, { ttl: 86_400_000 });
if (used > plan.dailyLimit) {
  throw new PaymentRequiredException(); // the increment still counted the attempt
}
```

For token-bucket / sliding-window *enforcement* with guards and headers, use the [rate limiter](/en/reference/rate-limit/) — quotas here are domain accounting.

## Batch Flush Aggregation

Accumulate cheaply on the hot path, ship totals periodically, never double-count:

```typescript
@Cron(CronExpression.EVERY_MINUTE)
@LeaderOnly() // one instance ships the batch
async shipEmailStats() {
  const sent = await this.counters.getAndReset('emails:batch');
  if (sent > 0) await this.analytics.track('emails_sent', sent);
}
```

## Live Statistics

<<< @/apps/demo/src/plugins/counters/service.usage.ts{typescript}

## Seat / Stock Inventory

```typescript
const left = await this.counters.decrement(`seats:${eventId}`);
if (left < 0) {
  await this.counters.increment(`seats:${eventId}`); // compensate
  throw new ConflictException('sold out');
}
```

For bounding *concurrent work* rather than stock, use the [semaphore](/en/reference/semaphore/).

## Fleet-Wide ID Generation

<<< @/apps/demo/src/plugins/counters/sequences.usage.ts{typescript}
