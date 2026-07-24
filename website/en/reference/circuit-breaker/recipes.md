---
title: 'Recipes — Circuit Breaker Plugin | NestJS RedisX'
description: 'Practical circuit breaker patterns for NestJS: cache fallbacks, per-dependency circuits, skip-on-open, health-probe driven breakers, and operator tooling.'
---

# Recipes

## Fallback to a cached value

Return a cached/default value instead of throwing while the breaker is OPEN — the dependency gets time to recover, users get slightly stale data instead of errors.

<<< @/apps/demo/src/plugins/circuit-breaker/recipes/fallback-cache.usage.ts{typescript}

## One breaker per dependency (or per tenant)

Use a stable key per dependency so failures of one dependency never trip another, and interpolate arguments for finer-grained circuits.

<<< @/apps/demo/src/plugins/circuit-breaker/recipes/per-dependency-keys.usage.ts{typescript}

## Skip instead of throw

For non-critical background work, resolve to `undefined` while OPEN instead of throwing; for trusted internal traffic, bypass the breaker entirely with `skip()`.

<<< @/apps/demo/src/plugins/circuit-breaker/recipes/skip-non-critical.usage.ts{typescript}

## Health-probe driven breaker

Drive the breaker from a scheduled health probe with the manual API instead of wrapping every call — hot-path code only reads the state.

<<< @/apps/demo/src/plugins/circuit-breaker/recipes/health-probe.usage.ts{typescript}

## Inspecting and resetting

Surface a degraded-mode banner from the non-mutating `getState`, and force a circuit back to CLOSED with `reset()` after a fix ships.

<<< @/apps/demo/src/plugins/circuit-breaker/recipes/inspect-reset.usage.ts{typescript}
