---
title: 'Semaphore Troubleshooting | NestJS RedisX'
description: 'Saturated semaphores, permits lost mid-work, capacity mismatches, and release errors explained.'
---

# Troubleshooting

## Every acquisition times out

The semaphore is saturated or seats leaked under a TTL that outlives your deployment cycle.

1. Check occupancy: `usedPermits(key)` vs your capacity.
2. If holders are long gone, the TTL is still running — either wait it out or `forceReleaseAll(key)`.
3. Raise `retry.maxRetries` / `waitTimeout` if the work is genuinely long but healthy.

## `SemaphorePermitNotHeldError` on release

The seat expired (or was force-released) **before the work finished** — the fleet temporarily ran more than `permits` concurrent executions.

- With auto-renewal **off**: your TTL is shorter than the work. Raise it or enable renewal.
- With auto-renewal **on**: look for the earlier `Auto-renewal failed` warning — a Redis outage longer than the remaining TTL loses the seat; the error on release is the honest report.

## Different callers see different capacities

`permits` travels with the call. If two code paths pass different numbers for the same key, the bound is whichever value the acquiring call provides — effectively the behavior flaps. Define the capacity once as a shared constant next to the key.

## The method runs without any bound

A warning like `@WithSemaphore: SemaphoreService not yet available` means the plugin is not registered (or the call happened before bootstrap finished). Register `SemaphorePlugin` in `RedisModule.forRoot({ plugins: [...] })` — the decorator is fail-open by design.

## Lua / NOSCRIPT noise after failovers

The store retries `EVALSHA` as plain `EVAL` on `NOSCRIPT` automatically and re-caches the script; a warning during bootstrap (`Lua pre-load failed`) is harmless — scripts load lazily per call.

## Clock skew between instances

Expiry decisions use the **Redis server clock** (the store keeps a cached `TIME` offset, re-synced every 30s), so NTP drift on an application node cannot sweep other instances' live permits. If permits seem to lapse early or late, compare the REDIS host's clock with reality — the fleet follows it.

## Cluster deployments

One semaphore is one key — no hash tags, no cross-slot operations. Nothing special to configure.
