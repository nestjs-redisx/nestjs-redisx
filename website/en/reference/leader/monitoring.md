---
title: 'Monitoring — Leader Election Plugin | NestJS RedisX'
description: 'Observing leader elections: redisx_leader_* Prometheus counters, onElected/onLost callbacks, log lines, and a leadership status endpoint.'
---

# Monitoring

## Metrics

With the [Metrics plugin](../metrics/) registered, elections emit automatically:

| Metric | Labels | Meaning |
|--------|--------|---------|
| `redisx_leader_elected_total` | `group` | Times this instance became leader |
| `redisx_leader_lost_total` | `group`, `reason` | Times it lost leadership (`expired` / `stepdown` / `shutdown`) |

Useful PromQL:

```promql
# Leadership churn per group (should be ~0 outside deployments)
sum by (group) (rate(redisx_leader_lost_total{reason="expired"}[15m]))

# Which instance currently leads (1 where elected most recently)
max by (instance, group) (increase(redisx_leader_elected_total[5m]))
```

Frequent `reason="expired"` losses outside deployments mean renewals are failing — look at Redis latency and event-loop blocking, or widen the `ttlMs`/`renewIntervalMs` gap.

## Lifecycle Callbacks

<<< @/apps/demo/src/plugins/leader/events.setup.ts{typescript}

Callbacks are fire-and-forget: a throwing listener is logged and never breaks the election loop.

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

- `redisx_leader_lost_total{reason="expired"}` increasing outside deploy windows — unstable leadership.
- No instance reporting `isLeader: true` for longer than `ttlMs + retryIntervalMs` — elections stuck (Redis down: by design nobody leads).

## Next Steps

- [Failover](./failover) — expected timings during transitions
- [Troubleshooting](./troubleshooting) — diagnosing stuck or flapping elections
