---
title: '@WithSemaphore Decorator | NestJS RedisX'
description: 'Bound concurrent executions of any @Injectable method across the fleet: key templates, waitTimeout, auto-renewal, and the onUnavailable policy.'
---

# @WithSemaphore

Proxy-based decorator (same mechanism as `@WithLock`): works on **any** `@Injectable` method, not just controllers.

<<< @/apps/demo/src/plugins/semaphore/decorator.usage.ts{typescript}

## Options

| Option | Type | Description |
|--------|------|-------------|
| `key` | `string \| (...args) => string` | Semaphore key; `{n}` interpolates the n-th argument |
| `permits` | `number` | Capacity - same value on every decorator using this key |
| `ttl` | `number?` | Permit TTL |
| `waitTimeout` | `number?` | Total wait budget for a seat |
| `autoRenew` | `boolean?` | Per-method renewal override |
| `onUnavailable` | `'throw' \| 'skip' \| (key) => Error` | What to do when no permit could be acquired - saturation, store outage, or shutdown alike (default `'throw'`; a policy function returning a non-Error falls back to the original error) |

## `onUnavailable` Policies

- **`'throw'`** (default) - `SemaphoreAcquisitionError` propagates; right for request handlers where the caller should see 503/429.
- **`'skip'`** - the method resolves `undefined` without running; right for periodic work that will come back on the next tick.
- **function** - map saturation to your own domain error.

The policy applies **only to acquisition** - and to every acquisition failure: saturation (`exhausted`/`timeout`), a store outage (`error`), and shutdown. An error thrown by the method body always propagates, and the permit is always released. Detection is cross-copy-safe (by error code), so a mixed CJS+ESM process keeps the policy working.

## Composing with `@Cron`

Both orders are safe - the wrapper carries over metadata stamped by decorators below it, so `@WithSemaphore()` above `@Cron()` does **not** unregister the job:

```typescript
@Cron(CronExpression.EVERY_MINUTE)
@WithSemaphore({ key: 'sync', permits: 1, onUnavailable: 'skip' })
async sync() { /* at most one sync at a time, fleet-wide */ }
```

## Without the Plugin

If `SemaphorePlugin` is not registered, the method executes **without a bound** and logs a warning - fail-open. A missing ceiling is observable and recoverable; a silently skipped business method is not. (Contrast with `@LeaderOnly`, where fail-safe means *skip*: running singleton work everywhere is the unrecoverable direction there.)
