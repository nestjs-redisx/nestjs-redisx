---
title: '@LeaderOnly Decorator — Leader Election Plugin | NestJS RedisX'
description: 'Gate any @Injectable method by leadership with @LeaderOnly: composition with @nestjs/schedule @Cron, election groups, and fail-safe skip semantics.'
---

# @LeaderOnly Decorator

Run a method only on the elected leader instance; everywhere else it resolves to `undefined` without executing.

## Usage

<<< @/apps/demo/src/plugins/leader/leader-only-cron.usage.ts{typescript}

## Options Reference

```typescript
interface ILeaderOnlyOptions {
  group?: string; // election group, default 'default'
}
```

## How It Works

`@LeaderOnly` is a **proxy-based method decorator** (like `@Cached` and `@WithLock`): it wraps the method at class-load time and resolves the leader service lazily on each call. That means:

- It works on **any `@Injectable` method** — services, jobs, repositories — not just controllers.
- It composes with `@nestjs/schedule`: `@Cron` fires on every instance; the wrapped body checks `isLeader(group)` and either runs or skips.
- The group named in the decorator **registers itself at decoration time**, so its election starts at application bootstrap — leadership is already resolved by the first cron tick (the first election round is awaited during `onModuleInit`).

## Skip Semantics (fail-safe)

When the method is skipped, the call resolves to `undefined` — no error, no retry:

| Situation | Behavior |
|-----------|----------|
| This instance is a follower | Skipped |
| Leadership lost mid-flight (lease expired) | The current invocation FINISHES; the next one skips |
| `LeaderPlugin` not registered / not initialized yet | **Skipped, with a one-time warning** |

The last row is deliberate: for singleton work, "nobody runs" is recoverable (the next tick after initialization runs normally), while "everybody runs" — the failure mode of falling through without a leader check — is not.

::: warning Return type
A gated method returns `Promise<T | undefined>` semantically — callers that use the return value should handle the skipped case. Scheduled jobs typically ignore it.
:::

## Decorator Order with @Cron

Both orders work — `@Cron` registers the method with the scheduler, `@LeaderOnly` wraps its body:

```typescript
@Cron(CronExpression.EVERY_HOUR)
@LeaderOnly()
async job() {}
```

## Programmatic Alternative

Inside code paths where a decorator does not fit, use the service directly:

```typescript
await this.leaderService.runIfLeader(() => this.rebuildIndex());
```

## Next Steps

- [Service API](./service-api) — `isLeader`, `runIfLeader`, `stepDown`
- [Recipes](./recipes) — startup migrations, maintenance drains
