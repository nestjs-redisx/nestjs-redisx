---
title: 'Monitoring - Leader Election Plugin | NestJS RedisX'
description: 'Observing leader elections: redisx_leader_* Prometheus counters, onElected/onLost callbacks, log lines, and a leadership status endpoint.'
---

# Monitoring

## Metrics

With the [Metrics plugin](../metrics/) registered, elections emit automatically:

| Metric | Labels | Meaning |
|--------|--------|---------|
| `redisx_leader_elected_total` | `group` | Times this instance became leader |
| `redisx_leader_lost_total` | `group`, `reason` | Times it lost leadership (`expired` / `stepdown` / `shutdown`) |

A custom `MetricsPlugin({ prefix })` renames the series accordingly (e.g. `myapp_leader_elected_total`) - adjust the queries below to your prefix.

Useful PromQL:

```promql
# Leadership churn per group (should be ~0 outside deployments)
sum by (group) (rate(redisx_leader_lost_total{reason="expired"}[15m]))

# Recent elections by instance (deployment/failover forensics)
sum by (instance, group) (increase(redisx_leader_elected_total[15m]))
```

Counters cannot answer "who leads right now" - a stable leader elected an hour ago shows zero increase in any window. Read the current leader from the status endpoint below (`getLeaderId()`), or export a gauge from your own `onElected`/`onLost` callbacks.

Frequent `reason="expired"` losses outside deployments mean renewals are failing - look at Redis latency and event-loop blocking, or widen the `ttlMs`/`renewIntervalMs` gap.

## Lifecycle Callbacks

<<< @/apps/demo/src/plugins/leader/events.setup.ts{typescript}

Callbacks are fire-and-forget: a throwing listener is logged and never breaks the election loop.

`onElected` and `onLost` strictly alternate per group - every gained leadership is closed by exactly one loss event before the next election, so pairing them to start/stop a singleton worker is safe. A lease that expires without a tick observing it (event-loop stall, clock jump) reports `onLost(group, 'expired')` before any re-election, and a lapse watchdog fires that event on time even while the heartbeat's store call is still dangling on a hung connection - the stop signal does not wait for the socket to time out.

## Log Lines

The service logs every transition with the instance identity:

```
[LeaderService] Instance "api-7f9c-1234" became leader of "default"
[LeaderService] Instance "api-7f9c-1234" lost leadership of "default" (stepdown)
```

Set a stable `instanceId` (pod name) to make these greppable across restarts.

## Status Endpoint

Expose leadership state for dashboards and debugging:

<<< @/apps/demo/src/plugins/leader/service-status.usage.ts{typescript}

The example app ships a ready-made variant at `GET /demo/leader/status`.

## What to Alert On

- `redisx_leader_lost_total{reason="expired"}` increasing outside deploy windows - unstable leadership.
- No instance reporting `isLeader: true` for longer than `ttlMs + retryIntervalMs` - elections stuck (Redis down: by design nobody leads).

## Next Steps

- [Failover](./failover) - expected timings during transitions
- [Troubleshooting](./troubleshooting) - diagnosing stuck or flapping elections
