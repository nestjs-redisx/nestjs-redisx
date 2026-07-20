---
title: 'Monitoring — Circuit Breaker Plugin | NestJS RedisX'
description: 'Observe NestJS RedisX circuit breaker state with getState: build health checks and dashboards without mutating the breaker.'
---

# Monitoring

`getState(key)` returns a non-mutating snapshot of a circuit, so you can poll it from a health endpoint or scheduled job without affecting behaviour (it never flips OPEN → HALF_OPEN).

<<< @/apps/demo/src/plugins/circuit-breaker/monitoring.usage.ts{typescript}

## Snapshot fields

```typescript
interface ICircuitSnapshot {
  state: 'closed' | 'open' | 'half-open';
  failuresInWindow: number; // CLOSED: failures still inside the rolling window
  halfOpenSuccesses: number; // HALF_OPEN: probes that have succeeded
  halfOpenInFlight: number; // HALF_OPEN: permitted probes not yet resolved
}
```

## Ideas

- **Health check** — report `degraded` when any circuit is not `closed`.
- **Dashboards** — expose per-circuit `state` as a gauge (0 = closed, 1 = half-open, 2 = open).
- **Alerts** — page when a critical circuit stays OPEN longer than expected.

::: tip
Pair this with the [Metrics plugin](../metrics/) to publish circuit state as Prometheus gauges alongside your other application metrics.
:::
