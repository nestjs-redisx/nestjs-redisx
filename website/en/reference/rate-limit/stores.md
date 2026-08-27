---
title: 'Stores — Rate Limit Plugin | NestJS RedisX'
description: 'Redis vs in-memory rate limit stores in @nestjs-redisx/rate-limit: per-route selection, latency vs exactness trade-offs, memory sizing, and reset semantics.'
---

# Stores: Redis vs In-Memory

The rate limit check runs on the critical path of **every** request. The plugin
ships two interchangeable store backends so you can choose, per route, between
an exact distributed limit and a zero-latency per-instance one.

| | `store: 'redis'` (default) | `store: 'memory'` |
|---|---|---|
| Counter location | Redis, shared by all instances | Process memory, per instance |
| Request-path cost | One Redis round-trip | Microseconds, no I/O |
| Global limit | Exact | Approximate (~ per-node limit × node count) |
| Survives restarts | Yes (until TTL) | No (deploy resets counters) |
| `reset()` / `getState()` | Global | Per-instance |
| Fits | Auth throttling, quotas, exact contracts | Anti-abuse and overload protection on bulk traffic |

## When the Memory Store Shines

If your Redis deployment adds latency to the hot path — a far cluster node,
cross-AZ hops — the memory store removes the rate-limit round-trip from every
request. Note the cluster detail: a given key hashes deterministically to one
shard, so with a far node **some users always pay the slow path** on every
request; the memory store eliminates that entirely.

Per-instance limiting is standard industry practice for abuse protection:
nginx `limit_req` is per-instance only, Envoy recommends its local rate limit
filter as the first line of defense even alongside a global one, and Kong
ships a `local` policy. The trade-off they all accept: with N even-loaded
nodes, a spraying client gets roughly N× the per-node limit. Size the
per-node limit as `globalTarget / expectedNodeCount` and treat it as an
abuse ceiling, not an exact quota.

::: warning Keep security-sensitive routes on `redis`
A distributed brute force divides its attempts across your nodes, so a
per-node threshold on login, OTP, or password-reset routes is effectively
multiplied by the node count. Pin those routes to the exact store — they are
low-QPS, the Redis round-trip does not hurt there. The same applies to billing
quotas and monetized plan enforcement.
:::

## Choosing a Plugin Default

Register the plugin with `store: 'memory'` when most routes need cheap
anti-abuse limiting; the sensitive few override back to Redis:

<<< @/apps/demo/src/plugins/rate-limit/store-memory.setup.ts{typescript}

## Per-Route Selection

The decorator's `store` option overrides the plugin default in either
direction:

<<< @/apps/demo/src/plugins/rate-limit/store-per-route.usage.ts{typescript}

The same override is available programmatically on every service call:

```typescript
await rateLimitService.check(`login:${email}`, {
  store: 'redis',
  points: 5,
  duration: 300,
});
```

## Reset and Inspection Semantics

`reset(key)` with no arguments sweeps **both** stores across all algorithm
variants — the service cannot know where a key was counted. Pass
`{ store }` to target one:

<<< @/apps/demo/src/plugins/rate-limit/store-reset.usage.ts{typescript}

Semantics to keep in mind:

- **Redis keys reset globally** — one call clears the counter for every
  instance at once. This is exactly the store your admin "unblock user"
  flows should target.
- **Memory keys reset per instance** — the call clears the counter only on
  the node that served it. Other nodes self-heal when the short window
  expires. If a route genuinely needs admin reset or precise inspection,
  that is the signal it belongs on `store: 'redis'`.
- **`peek()` / `getState()` honor `config.store`** and report the same
  per-instance view for memory-backed keys.
- For observability of memory-backed limits, use the request counters from
  the [Metrics plugin](../metrics/) (each instance exports its own series)
  rather than `getState()`.

## Memory Sizing

Redis bounds its keyspace with `EXPIRE`; the memory store bounds itself:

- `memory.maxKeys` (default `100000`) — cap on tracked keys. When exceeded,
  the oldest entries are evicted (approximate FIFO). This is the defense
  against key spray: random IPs or spoofed API keys cannot grow the map
  without bound.
- `memory.sweepIntervalMs` (default `30000`) — how often expired entries are
  swept. Entries are also lazily discarded on access, so the sweep only
  controls how quickly idle garbage is reclaimed.

A tracked key costs on the order of a hundred bytes (sliding-window entries
also hold up to `points` timestamps), so the default cap stays in the tens of
megabytes even under attack.

## Both Stores Are Always Available

Both adapters register regardless of the `store` default, so per-route
overrides work without extra configuration. The Redis connection remains
required (the core module owns it); the memory store removes Redis from the
request path, not from the deployment. Counters for the same logical key in
the two stores are fully independent — they never synchronize.

## Next Steps

- [Configuration](./configuration) — All plugin options
- [Decorator](./decorator) — `@RateLimit` reference
- [Service API](./service-api) — Programmatic checks, peek, reset
- [Monitoring](./monitoring) — Metrics for allowed/rejected requests
