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

## The job runs on more than one instance

- The method is decorated with `@Cron` but **missing `@LeaderOnly`** on some code path.
- Two deployments use **different `keyPrefix`/groups** for what you consider one election — each prefix+group pair is an independent seat.
- Long work started before a demotion is still in flight while the new leader begins. That overlap is inherent to leases — fence the critical section with a [lock](../locks/).

## Leadership flaps (frequent `expired` losses)

Renewals are failing to land within the lease. Typical causes:

- Redis latency spikes longer than `ttlMs - renewIntervalMs`;
- event-loop blocking (large JSON, sync crypto) delaying the heartbeat timer;
- `renewIntervalMs` too close to `ttlMs`.

Widen the gap (`renewIntervalMs ≈ ttlMs / 3`) and watch `redisx_leader_lost_total{reason="expired"}`.

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

## Testing: elections interfere between specs

Manual `LeaderService` instances keep timers — always `await service.onModuleDestroy()` in `afterEach`, and reset the decorator getter/registry (`registerLeaderServiceGetter(null)`, `clearRegisteredLeaderGroups()`) between suites.
