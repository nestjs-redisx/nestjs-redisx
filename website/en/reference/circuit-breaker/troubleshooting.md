---
title: 'Troubleshooting — Circuit Breaker Plugin | NestJS RedisX'
description: 'Fix common NestJS RedisX circuit breaker issues: breaker never trips, never recovers, opens too eagerly, or the decorator has no effect.'
---

# Troubleshooting

## The breaker never trips

- Failures are only counted when the guarded function **throws** (or `recordFailure` is called). If your function catches its own errors and returns normally, the breaker sees a success. Let the error propagate, or call `recordFailure` explicitly.
- `failureThreshold` failures must land **within `windowMs`**. A slow trickle of errors ages out of the rolling window before the threshold is reached — lower `failureThreshold` or increase `windowMs`.

## The breaker never recovers

- Recovery starts only after `openDurationMs` **and** on the next request — a passive `getState` does not flip OPEN → HALF_OPEN. Make a real call (or `execute`) after the cooldown.
- In HALF_OPEN, a single probe failure re-opens the breaker. If the dependency is still flapping, it will keep re-opening; raise `openDurationMs` to back off longer.

## The breaker opens too eagerly

- Increase `failureThreshold`, or shrink `windowMs` so transient spikes age out faster.
- Make sure you are not sharing one key across unrelated dependencies — use a distinct `key` per dependency.

## `@WithCircuitBreaker` has no effect

- The decorator wraps the method via a proxy and needs the plugin registered in `RedisModule.forRoot({ plugins: [new CircuitBreakerPlugin()] })`. Until the plugin initializes, calls run **without** the breaker and a warning is logged.
- The decorator works on any Injectable method — but the instance must be created by Nest (so the wrapped descriptor is used).

## The breaker seems stuck in HALF_OPEN

Each permitted half-open probe consumes a slot (`halfOpenInFlight`). If a probe's outcome is never recorded (the process crashed mid-probe, or recording failed because the state store was momentarily unavailable — this is logged), the slot is **reclaimed automatically after `probeTimeoutMs`** (default: `openDurationMs`), so recovery resumes on its own.

If calls are being rejected in `half-open`, it usually just means a probe is still in flight (or its `probeTimeoutMs` has not elapsed yet). Remedies if you need to act faster:

- **immediate** — call `reset(key)` (or the admin tooling from [Recipes](./recipes)) to force the circuit back to CLOSED;
- **tune** — lower `probeTimeoutMs` if your probes should resolve quickly, or raise `halfOpenMaxCalls` so one slow probe cannot exhaust the probe budget.

As a last backstop, all circuit keys carry a TTL (about `2 × max(windowMs, openDurationMs) + 60s`) after which the state self-heals completely.

## `CircuitBreakerStoreError` under load

- This means the **state store** (Redis) failed, not that the breaker opened. Choose `errorPolicy: 'fail-open'` to keep serving traffic when Redis is unavailable, or `'fail-closed'` (default) to surface the error.

## Cluster deployments

Each circuit uses three keys sharing a hash tag (`{cb:key}`, `{cb:key}:f`, `{cb:key}:p`), so they always resolve to the same slot. No extra configuration is required for Redis Cluster.
