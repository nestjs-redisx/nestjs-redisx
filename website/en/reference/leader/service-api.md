---
title: 'Service API - Leader Election Plugin | NestJS RedisX'
description: 'Reference for LEADER_SERVICE (ILeaderService): instanceId, isLeader, getLeaderId, runIfLeader, stepDown, and getGroups.'
---

# Service API

## Service Injection

<<< @/apps/demo/src/plugins/leader/service-status.usage.ts{typescript}

## instanceId

This process's identity - the value stored in the election key while it leads, and what `getLeaderId()` returns on other instances. Defaults to `${hostname}-${pid}-${random}`; set `instanceId` in the options (e.g. the pod name) for stable identities in logs and dashboards.

## isLeader()

```typescript
isLeader(group?: string): boolean
```

Synchronous **local lease view** - no Redis round-trip, safe to call on every request or cron tick. Returns `true` only while the last confirmed lease is unexpired; a group with no running election returns `false`.

## getLeaderId()

```typescript
getLeaderId(group?: string): Promise<string | null>
```

Reads the election key from Redis - works on any instance, leader or follower. Returns `null` when nobody holds the lease. Throws `LeaderStoreError` when the store call fails (this is a direct API call, unlike the background loop which contains its errors). On a read-scaled cluster (`scaleReads` to replicas) this GET may be served by a replica and briefly lag the election - election correctness is unaffected (all lease mutations are master-side CAS scripts), only this observability read can be stale.

## runIfLeader()

```typescript
runIfLeader<T>(fn: () => T | Promise<T>, group?: string): Promise<T | undefined>
```

Executes `fn` only when this instance leads the group; resolves to `undefined` otherwise. The programmatic twin of `@LeaderOnly`.

## stepDown()

```typescript
stepDown(group?: string): Promise<void>
```

Voluntarily hand leadership over: release the lease (CAS delete) and abstain from candidacy for one `ttlMs`, so another instance wins instead of this one immediately re-acquiring. Emits `onLost(group, 'stepdown')` at demotion time - before the release lands, like the `expired` path (`shutdown`, by contrast, fires after its bounded release attempt, still before `onModuleDestroy()` resolves). After `stepDown()` resolves, this instance no longer *claims* a lease locally, and the key is cleared too - including a stale own lease left behind by a fail-safe demotion - **provided the release lands**: if the store call fails it is logged (see the cheat sheet below) and the key holds this instance's id for up to the remaining `ttlMs`; the next graceful shutdown retries the release. A no-op for groups without a running election.

<<< @/apps/demo/src/plugins/leader/step-down.usage.ts{typescript}

## getGroups()

```typescript
getGroups(): string[]
```

Groups with running elections on this instance - the union of `'default'`, the configured `groups`, and every group referenced by `@LeaderOnly` decorators.

## Semantics Cheat Sheet

| Call | Redis I/O | On store failure |
|------|-----------|------------------|
| `isLeader()` | none | n/a (local state) |
| `getLeaderId()` | GET | throws `LeaderStoreError` |
| `runIfLeader()` | none (local check) | n/a |
| `stepDown()` | CAS DEL | logged, local demotion still happens |

## Next Steps

- [Monitoring](./monitoring) - counters and lifecycle callbacks
- [Failover](./failover) - behavior on shutdown and crash
