---
title: 'Semaphore Recipes | NestJS RedisX'
description: 'Fleet-wide worker pools, per-tenant concurrency bounds, protecting fragile dependencies, and skip-when-saturated patterns.'
---

# Recipes

## Fleet-Wide Worker Pool

Bound heavy work (video encoding, PDF rendering, ML inference) to N concurrent executions across every replica:

<<< @/apps/demo/src/plugins/semaphore/decorator.usage.ts{typescript}

Scale replicas freely — the ceiling stays N.

## Protecting a Fragile Dependency

A legacy API or database that tolerates only a handful of concurrent callers:

<<< @/apps/demo/src/plugins/semaphore/service.usage.ts{typescript}

Combine with the [circuit breaker](/en/reference/circuit-breaker/): the semaphore bounds *concurrency*, the breaker reacts to *failures* — they solve different halves of the problem. Use [rate limiting](/en/reference/rate-limit/) when the contract is "requests per second" rather than "requests in flight".

## Per-Tenant Bounds

A `{n}` template gives every tenant its own semaphore:

```typescript
@WithSemaphore({ key: 'export:{0}', permits: 1, onUnavailable: 'skip' })
async exportTenant(tenantId: string) { /* one export per tenant at a time */ }
```

## Skip-When-Saturated Cron

Periodic work that should not queue behind itself:

```typescript
@Cron(CronExpression.EVERY_MINUTE)
@WithSemaphore({ key: 'warmup', permits: 2, waitTimeout: 1000, onUnavailable: 'skip' })
async warmCaches() { /* at most 2 warmups in flight; extras skip this tick */ }
```

## Draining for Maintenance

Freeze a semaphore by watching it, then force-free seats stuck behind an incident:

<<< @/apps/demo/src/plugins/semaphore/monitoring.usage.ts{typescript}

`forceReleaseAll` never interrupts running work — in-flight holders complete, and the seats open immediately. Their eventual `release()` throws `SemaphorePermitNotHeldError` (the honest signal the seat was taken away); `withPermit` and `@WithSemaphore` absorb it into an error log.
