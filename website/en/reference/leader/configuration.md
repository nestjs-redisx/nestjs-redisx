---
title: 'Configuration — Leader Election Plugin | NestJS RedisX'
description: 'LeaderPlugin configuration: lease TTL, heartbeat and retry intervals, election groups, instance identity, lifecycle callbacks, and fail-fast validation.'
---

# Configuration

## Basic Configuration

<<< @/apps/demo/src/plugins/leader/basic.setup.ts{typescript}

## Complete Options Reference

```typescript
new LeaderPlugin({
  // Named Redis client (from RedisModule clients). Default: 'default'
  client: 'default',

  // Key prefix: election key is `${keyPrefix}${group}`
  keyPrefix: 'leader:',

  // Leadership lease TTL. A crashed leader is replaced within roughly
  // ttlMs + retryIntervalMs; a gracefully stopped one immediately.
  ttlMs: 15_000,

  // Heartbeat while leader. MUST be strictly less than ttlMs —
  // validation fails fast otherwise.
  renewIntervalMs: 5_000,

  // Acquire retry while follower. Also bounds how quickly a follower
  // notices a freed seat.
  retryIntervalMs: 2_000,

  // Extra elections to start at bootstrap. The 'default' group always
  // runs, and @LeaderOnly({ group }) registers its groups automatically.
  groups: ['reports'],

  // Identity stored in the election key. Default: `${hostname}-${pid}-${random}`
  instanceId: process.env.POD_NAME,

  // Fire-and-forget lifecycle callbacks (errors are logged, never thrown)
  onElected: (group) => {},
  onLost: (group, reason) => {}, // reason: 'expired' | 'stepdown' | 'shutdown'
})
```

## Lifecycle Callbacks and Groups

<<< @/apps/demo/src/plugins/leader/events.setup.ts{typescript}

## Async Configuration

```typescript
RedisModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  plugins: [
    LeaderPlugin.registerAsync({
      useFactory: () => ({
        ttlMs: parseInt(process.env.LEADER_TTL_MS || '15000', 10),
        instanceId: process.env.POD_NAME,
      }),
    }),
  ],
  useFactory: (config: ConfigService) => ({
    clients: { host: config.get('REDIS_HOST', 'localhost'), port: 6379 },
  }),
});
```

## Tuning Guide

| Goal | Setting |
|------|---------|
| Faster crash failover | Lower `ttlMs` (more heartbeat traffic) |
| Less Redis traffic | Raise `ttlMs` + `renewIntervalMs` (slower crash failover) |
| Faster takeover of a freed seat | Lower `retryIntervalMs` |
| Stable identity in logs/metrics | Set `instanceId` to a value UNIQUE per replica (e.g. the pod name) |

Rule of thumb: `renewIntervalMs ≈ ttlMs / 3`. The gap is your budget for Redis latency spikes and event-loop pauses before a healthy leader gets demoted.

::: danger `instanceId` must be unique per replica
Two replicas presenting the same id BOTH win the election: acquire deliberately re-claims a key that already holds the caller's own id (that is what makes restarts with a stable id seamless). A shared value — a host name with several workers per host (pm2 cluster mode), a fleet-wide constant — silently collapses "exactly one instance" into "every instance". Use the pod name, or leave it unset for a generated unique id.
:::

## Validation (fail-fast)

Invalid configuration throws `InvalidLeaderConfigError` at construction — on both the sync and `registerAsync` paths, never masked:

- `ttlMs`, `renewIntervalMs`, `retryIntervalMs` — positive integers up to 2³¹−1 ms (~24.8 days, the JS timer range; a larger value would be clamped by `setTimeout` to 1 ms and hot-loop)
- `renewIntervalMs < ttlMs` — a lease must outlive its own heartbeat
- `groups` — non-empty strings; `instanceId` — non-empty when provided
- `keyPrefix` — non-empty when provided (an empty prefix would make the election key a bare group name)
- `onElected` / `onLost` — functions when provided (a dead callback would otherwise only surface as a contained warning on the winning pod, silently skipping the paired singleton work)
- the options value itself — a plain object: `undefined`/`null` (a `registerAsync` factory returning `undefined` for a missing config key), an accidentally list-wrapped config, and an un-awaited `Promise` (`new LeaderPlugin(loadConfig())` with an async loader — zero own keys, so every per-key check would otherwise pass) all fail with a source-tagged error instead of a bare TypeError or a silent all-defaults boot; `@LeaderOnly` applies the same rejection (null, array, thenable) to its own argument — only the documented zero-argument form gates `'default'`

Register **one** `LeaderPlugin` per application — a second instance is rejected by `RedisModule` (their injection tokens would collide and the first plugin's options would be silently discarded). Several elections belong in one plugin's `groups` option.

## Next Steps

- [Failover](./failover) — what these numbers mean in takeover time
- [@LeaderOnly Decorator](./decorator) — per-method gating
