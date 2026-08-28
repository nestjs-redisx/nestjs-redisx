---
title: 'Failover — Leader Election Plugin | NestJS RedisX'
description: 'Leader failover timings in @nestjs-redisx/leader: instant handover on graceful shutdown, TTL-bounded takeover after a crash, and stepDown cooldown semantics.'
---

# Failover

How fast another instance takes over, per scenario (defaults: `ttlMs` 15s, `renewIntervalMs` 5s, `retryIntervalMs` 2s).

| Scenario | What happens to the lease | Takeover time |
|----------|---------------------------|---------------|
| Graceful shutdown (`app.close()`, SIGTERM with shutdown hooks) | Released by `onModuleDestroy` | ≤ `retryIntervalMs` (~2s) |
| `stepDown()` | Released immediately | ≤ `retryIntervalMs` (~2s) |
| Crash / OOM / network partition | Expires on its own | ≤ `ttlMs + retryIntervalMs` (~17s) |
| Redis briefly unavailable | Leader demotes locally on the first failed renewal; re-election once Redis returns | pause, then ≤ `retryIntervalMs` |

## Graceful Shutdown

On `onModuleDestroy` the service stops all election loops and releases every held lease with a CAS delete, then emits `onLost(group, 'shutdown')`. Followers notice the freed seat on their next retry tick — deployment rollouts hand leadership over in seconds, without waiting for TTLs.

The core module deliberately closes Redis connections in `onApplicationShutdown` (a later lifecycle phase than `onModuleDestroy`), so this release — like every plugin cleanup that needs Redis — still has a live connection.

## Crash

A crashed leader stops heartbeating; the lease expires after `ttlMs` and the next follower retry wins the key. Nothing needs to detect the crash — the TTL is the detector.

## stepDown Cooldown

`stepDown()` releases the lease AND starts a one-`ttlMs` cooldown during which this instance abstains from candidacy. Without the cooldown, the stepping-down instance would usually win its own freed seat back before any follower's retry timer fired.

## During the Handover Window

Between a leader demoting and a follower winning, **nobody** runs gated work. That is the designed trade-off: for singleton jobs a missed tick is recoverable, a duplicated one often is not. If a job must not miss its slot, lower `retryIntervalMs` (and `ttlMs` for crash scenarios).

## Split-Brain Considerations

The local lease view makes a *sustained* double-leadership impossible: an instance that cannot confirm its lease stops claiming it. A brief overlap is still physically possible while a demoted leader has work **in flight** (e.g. a long HTTP call started before the lease expired). Where that matters, wrap the critical section in a [distributed lock](../locks/) — the election chooses who *starts* work; the lock guarantees exclusivity *inside* it.

## Next Steps

- [Configuration](./configuration) — tuning the three intervals
- [Monitoring](./monitoring) — observing elections in production
