---
title: 'Monitoring — Session Plugin | NestJS RedisX'
description: 'Session lifecycle events (onCreated, onDestroyed, onRevoked, onExpiredByCap) and Prometheus counters via MetricsPlugin.'
---

# Monitoring

## Lifecycle Events

Audit hooks are plain callbacks in the plugin options — fire-and-forget, failures are logged and never break a request:

<<< @/apps/demo/src/plugins/session/audit-events.setup.ts{typescript}

| Event | Fires when |
|-------|-----------|
| `onCreated` | A session is written for the first time |
| `onDestroyed` | A session ends through the middleware (logout) |
| `onRevoked` | A session is revoked via the service API **or** evicted by a seat limit |
| `onExpiredByCap` | The absolute lifetime cap catches a live session on access |

Each callback receives `{ sessionId, userId? }`. The audit log itself is your application's job — these hooks are the wiring point (write to your SIEM, publish via the Pub/Sub plugin, etc.).

::: tip Natural expiry
Sessions that expire by TTL simply vanish from Redis — there is no callback for them (Redis has no reliable expiry hooks). Counts stay accurate because indexes are swept by expiry score on read.
:::

## Prometheus Metrics

When [`MetricsPlugin`](/en/reference/metrics/) is registered, the session store increments counters automatically (soft dependency — nothing to configure):

| Metric | Labels | Meaning |
|--------|--------|---------|
| `redisx_session_created_total` | — | Sessions written for the first time |
| `redisx_session_destroyed_total` | `reason: destroyed \| revoked \| expired-by-cap` | Sessions removed, by cause |
| `redisx_session_limit_rejections_total` | — | Logins refused by the `reject` seat-limit policy |

An active-sessions gauge is deliberately not emitted — it would drift as sessions expire server-side. For dashboards, expose `count()` from your own endpoint:

```typescript
@Get('metrics/sessions')
async sessionCount() {
  return { active: await this.sessions.count() };
}
```

## Example PromQL

```promql
# Logins per minute
rate(redisx_session_created_total[1m]) * 60

# Forced logouts (revocations + evictions) per hour
increase(redisx_session_destroyed_total{reason="revoked"}[1h])

# Seat-limit pressure
rate(redisx_session_limit_rejections_total[5m])
```
