---
title: 'Troubleshooting — Leader Election Plugin | NestJS RedisX'
description: 'Debugging leader election: jobs never running, leadership flapping, step-down comebacks, validation errors, and Redis outage behavior.'
---

# Troubleshooting

## A @LeaderOnly method never runs — on ANY instance

The decorator skips fail-safe when the leader service is unavailable. Check, in order:

1. **Is `LeaderPlugin` registered** in `RedisModule.forRoot({ plugins: [...] })`? Look for the one-time warning: `@LeaderOnly: LeaderService is not available…`.
2. **Is Redis reachable?** By design nobody leads while Redis is down (work pauses rather than duplicates). Elections resume automatically.
3. **Did every instance step down recently?** `stepDown()` starts a one-`ttlMs` candidacy cooldown on that instance.
4. **Was the `@LeaderOnly` class loaded lazily, after bootstrap?** Elections start once, in `onModuleInit`, from the groups known at that moment. A group registered later never gets an election, and `isLeader` answers `false` forever — with a one-time warning: `isLeader("<group>"): no election is running for this group…`. Reference the group at bootstrap instead (plugin `groups: [...]` option).

## The job runs on more than one instance

- Replicas share one **`instanceId`** (pm2 cluster mode, a fleet-wide constant): every replica presenting the current holder's id "wins" via the own-id re-claim, so ALL of them lead — persistently. See the [`instanceId` danger box](./configuration#tuning-guide); it must be unique per replica.
- The method is decorated with `@Cron` but **missing `@LeaderOnly`** on some code path.
- Two deployments use **different `keyPrefix`/groups** for what you consider one election — each prefix+group pair is an independent seat.
- Long work started before a demotion is still in flight while the new leader begins. That overlap is inherent to leases — fence the critical section with a [lock](../locks/).

## Leadership flaps (frequent `expired` losses)

Renewals are failing to land within the lease. Typical causes:

- Redis latency spikes longer than `ttlMs - renewIntervalMs`;
- event-loop blocking (large JSON, sync crypto) delaying the heartbeat timer;
- `renewIntervalMs` too close to `ttlMs`.

Widen the gap (`renewIntervalMs ≈ ttlMs / 3`) and watch `redisx_leader_lost_total{reason="expired"}`.

A demotion after an *errored* (as opposed to rejected) renewal is self-healing: the key still holds this instance's id, and the next retry tick re-claims it — a transient Redis blip costs one `retryIntervalMs` of leadership, not a full `ttlMs`.

## `InvalidLeaderConfigError` at startup

Validation is fail-fast, on the sync and `registerAsync` paths alike:

```
"renewIntervalMs" (15000) must be strictly less than "ttlMs" (15000)
```

Note the check uses the **effective** pair — setting only `ttlMs: 4000` fails because the default heartbeat (5000) would outlive it; set both.

## An instance never wins after stepDown

Working as designed: `stepDown()` includes a one-`ttlMs` cooldown so the freed seat goes to ANOTHER instance. Candidacy resumes automatically afterwards.

## getLeaderId() throws LeaderStoreError

Direct API calls propagate store failures (unlike the background loop, which contains them). Treat it like any Redis outage; `isLeader()` remains safe to call — it is local.

## Shutdown or stepDown hangs

Graceful shutdown is bounded end-to-end: the rendezvous with an in-flight election round and every release await forfeit after one `retryIntervalMs` each, and all groups tear down concurrently — so the whole plugin gives up after ~3 × `retryIntervalMs` regardless of how many groups run, and a black-holed connection cannot wedge `app.close()` behind the leader plugin — failover then falls back to the crash bound (`ttlMs + retryIntervalMs`). `stepDown()`, by contrast, awaits its release for as long as the driver allows: ioredis bounds commands at 5s by default, **node-redis only if you set `commandTimeout`** in the client config (honored by the driver adapter) — set it if you drain nodes over node-redis.

## Several Nest apps in one process

`@LeaderOnly` is bound to a class, not an application, and its service registry is process-global. With two live apps the decorator consults the **most recently initialized** app's leader service (a warning is logged), and each app also starts elections for every group any loaded decorator registered. Closing either app re-exposes the other's service. If the apps use different Redis targets or prefixes, prefer injecting `LEADER_SERVICE` and calling `isLeader()` explicitly over the decorator.

## Testing: elections interfere between specs

Manual `LeaderService` instances keep timers — always `await service.onModuleDestroy()` in `afterEach`, and reset the decorator getter/registry (`registerLeaderServiceGetter(null)`, `clearRegisteredLeaderGroups()`) between suites.

One subtle case: when `app.init()` REJECTS (some other module's init hook threw), Nest 10's `app.close()` rethrows the init error without running any destroy hooks — but the leader election may already be running and holding the lease. In a process that keeps living afterwards (a test worker, an in-process bootstrap retry), that orphaned election renews forever. Guard test bootstraps with `try { await app.init() } catch { await moduleRef.get(LEADER_SERVICE).onModuleDestroy(); throw }` (Nest 11 runs destroy hooks in this case); a crashed process needs nothing — the lease expires by `ttlMs`.
