---
title: 'Configuration — Circuit Breaker Plugin | NestJS RedisX'
description: 'Configure @nestjs-redisx/circuit-breaker: failure threshold, rolling window, open duration, half-open probes, key prefix, and error policy.'
---

# Configuration

## Options

`CircuitBreakerPlugin` accepts `ICircuitBreakerPluginOptions`:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `failureThreshold` | `number` | `5` | Failures within `windowMs` that trip CLOSED → OPEN. |
| `windowMs` | `number` | `10000` | Rolling window (ms) over which failures are counted in CLOSED. |
| `openDurationMs` | `number` | `30000` | Time (ms) the breaker stays OPEN before probes are allowed. |
| `halfOpenMaxCalls` | `number` | `1` | Max probe calls permitted while HALF_OPEN. |
| `successThreshold` | `number` | `1` | Successful probes required to close (must be ≤ `halfOpenMaxCalls`). |
| `keyPrefix` | `string` | `'cb:'` | Redis key prefix for circuit state. |
| `client` | `string` | `'default'` | Named Redis client to use. |
| `errorPolicy` | `'fail-open' \| 'fail-closed'` | `'fail-closed'` | Behaviour when the **state store** is unavailable. |
| `errorFactory` | `(key, snapshot) => Error` | — | Custom error thrown when the breaker rejects a call. |

All numeric knobs are validated at bootstrap (integers ≥ 1; `successThreshold <= halfOpenMaxCalls`) — an invalid config throws `InvalidCircuitBreakerConfigError` instead of silently misbehaving.

## Synchronous Setup

<<< @/apps/demo/src/plugins/circuit-breaker/basic-config.setup.ts{typescript}

## Asynchronous Setup

Load option values from `ConfigService` with `CircuitBreakerPlugin.registerAsync`, kept **outside** the connection `useFactory` (standard NestJS pattern):

<<< @/apps/demo/src/plugins/circuit-breaker/register-async.setup.ts{typescript}

## Error Policy

`errorPolicy` decides what happens when the **state store itself** (Redis) is unavailable — it does **not** affect what happens when the breaker is simply OPEN (that always rejects unless you provide a fallback).

- `fail-closed` (default): throw `CircuitBreakerStoreError`.
- `fail-open`: run the guarded call anyway, favouring availability.

<<< @/apps/demo/src/plugins/circuit-breaker/fail-open-closed.setup.ts{typescript}

## Per-call Overrides

Every knob can be overridden per method (via the decorator) or per call (via `execute`), e.g. `@WithCircuitBreaker({ key: 'x', failureThreshold: 10 })`. See the [decorator](./decorator) and [service](./service-api) pages.
