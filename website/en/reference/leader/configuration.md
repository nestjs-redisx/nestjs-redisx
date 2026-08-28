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
| Stable identity in logs/metrics | Set `instanceId` to the pod/host name |

Rule of thumb: `renewIntervalMs ≈ ttlMs / 3`. The gap is your budget for Redis latency spikes and event-loop pauses before a healthy leader gets demoted.

## Validation (fail-fast)

Invalid configuration throws `InvalidLeaderConfigError` at construction — on both the sync and `registerAsync` paths, never masked:

- `ttlMs`, `renewIntervalMs`, `retryIntervalMs` — positive safe integers
- `renewIntervalMs < ttlMs` — a lease must outlive its own heartbeat
- `groups` — non-empty strings; `instanceId` — non-empty when provided

## Next Steps

- [Failover](./failover) — what these numbers mean in takeover time
- [@LeaderOnly Decorator](./decorator) — per-method gating
