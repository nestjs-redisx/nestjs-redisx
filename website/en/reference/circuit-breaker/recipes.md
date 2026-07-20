---
title: 'Recipes — Circuit Breaker Plugin | NestJS RedisX'
description: 'Practical circuit breaker patterns for NestJS: cache fallbacks, skip-on-open, per-key breakers, and manual recording from health checks.'
---

# Recipes

## Fallback to a cached value

Return a cached/default value instead of throwing while the breaker is OPEN — either with the decorator or the service.

<<< @/apps/demo/src/plugins/circuit-breaker/decorator-basic.usage.ts{typescript}

The same, programmatically, with per-call `fallback`:

<<< @/apps/demo/src/plugins/circuit-breaker/service-basic.usage.ts{typescript}

## One breaker per dependency (or per tenant)

Use a stable key per dependency (`'stripe'`, `'users-api'`) so failures of one dependency never trip another. Interpolate arguments for finer-grained breakers:

```typescript
@WithCircuitBreaker({ key: 'users-api:{0}' }) // per user id
@WithCircuitBreaker({ key: (dto) => `tenant:${dto.tenantId}` }) // per tenant
```

## Skip instead of throw

For non-critical background work, resolve to `undefined` while OPEN instead of throwing:

```typescript
@WithCircuitBreaker({ key: 'analytics', onOpen: 'skip' })
async track(event: AnalyticsEvent) { /* ... */ }
```

## Manual recording from a health check

Drive the breaker from an external signal (a scheduled probe, a webhook) instead of wrapping every call:

```typescript
const healthy = await this.ping();
if (healthy) await this.breaker.recordSuccess('users-api');
else await this.breaker.recordFailure('users-api');
```

## Inspecting and resetting

```typescript
const { state } = await this.breaker.getState('stripe');
if (state === 'open') { /* surface a degraded-mode banner */ }

await this.breaker.reset('stripe'); // force back to CLOSED (e.g. after a deploy)
```
