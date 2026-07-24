---
title: 'Service API — Circuit Breaker Plugin | NestJS RedisX'
description: 'Programmatic circuit breaking with CircuitBreakerService: execute with fallback, manual recordSuccess/recordFailure, getState, and reset.'
---

# Service API

Inject `CIRCUIT_BREAKER_SERVICE` for full programmatic control when a decorator is not a good fit.

<<< @/apps/demo/src/plugins/circuit-breaker/service-basic.usage.ts{typescript}

## `ICircuitBreakerService`

- `execute<T>(key, fn, options?): Promise<T>` — run `fn` guarded by the breaker. On success records success; on throw records failure and rethrows. When the breaker rejects the call, returns `options.fallback()` if provided, otherwise throws the `errorFactory` error or `CircuitBreakerOpenError`.
- `recordSuccess(key, options?): Promise<ICircuitSnapshot>` — manually record a success (e.g. from an external health probe).
- `recordFailure(key, options?): Promise<ICircuitSnapshot>` — manually record a failure.
- `getState(key, options?): Promise<ICircuitSnapshot>` — read the committed state without mutating it (does not flip OPEN → HALF_OPEN).
- `reset(key): Promise<void>` — return the circuit to CLOSED and clear all state.

### `ICircuitSnapshot`

```typescript
interface ICircuitSnapshot {
  state: 'closed' | 'open' | 'half-open';
  failuresInWindow: number; // CLOSED: failures still inside the window
  halfOpenSuccesses: number; // HALF_OPEN: probes that have succeeded
  halfOpenInFlight: number; // HALF_OPEN: permitted probes not yet resolved
}
```

## Execute options

`ICircuitBreakerExecuteOptions` extends the per-call overrides (`failureThreshold`, `windowMs`, `openDurationMs`, `halfOpenMaxCalls`, `successThreshold`) with:

- `fallback?: () => T | Promise<T>` — returned instead of throwing when rejected.
- `errorFactory?: (key, snapshot) => Error` — custom rejection error (overrides the plugin-level factory).

::: tip Store errors vs open rejections
A rejection because the breaker is **OPEN** always surfaces as a fallback/`CircuitBreakerOpenError`. A failure of the **state store** (Redis) on the `execute()` gate is governed by `errorPolicy` — `fail-open` runs `fn` anyway, `fail-closed` throws `CircuitBreakerStoreError`. Recording success/failure never masks your function's own result or error.
:::

::: warning The manual API is always strict
`recordSuccess`, `recordFailure`, `getState`, and `reset` are **not** subject to `errorPolicy`: when the state store fails they always throw `CircuitBreakerStoreError`. There is no meaningful "fail-open" result for an explicit state operation — silently dropping a manual `recordFailure` would corrupt operator expectations.
:::

::: warning Invalid configuration always throws
Plugin options and per-call overrides are validated (integers ≥ 1, `successThreshold <= halfOpenMaxCalls`). An invalid config throws `InvalidCircuitBreakerConfigError` immediately — it is a programmer error and is never subject to `errorPolicy`.
:::
