---
title: '@WithCircuitBreaker Decorator | NestJS RedisX'
description: 'Guard any NestJS Injectable method with the proxy-based @WithCircuitBreaker decorator: keys, per-method overrides, fallbacks, and skip-on-open.'
---

# @WithCircuitBreaker Decorator

`@WithCircuitBreaker` wraps a method so every call goes through the breaker for a given key. Unlike a NestJS guard, it is **proxy-based** and works on **any** Injectable method — services, repositories, gateways — not just controllers (the same pattern as `@WithLock` and `@Cached`).

## Usage

<<< @/apps/demo/src/plugins/circuit-breaker/decorator-basic.usage.ts{typescript}

## Options

`IWithCircuitBreakerOptions`:

| Option | Type | Description |
|--------|------|-------------|
| `key` | `string \| (...args) => string` | Circuit key. Strings support `{0}`, `{1.id}` interpolation from arguments. |
| `failureThreshold` | `number` | Per-method override. |
| `windowMs` | `number` | Per-method override. |
| `openDurationMs` | `number` | Per-method override. |
| `halfOpenMaxCalls` | `number` | Per-method override. |
| `successThreshold` | `number` | Per-method override. |
| `fallback` | `(...args) => unknown` | Called with the original arguments when the breaker rejects; its return becomes the method result. |
| `onOpen` | `'throw' \| 'skip'` | When there is no `fallback`: throw `CircuitBreakerOpenError` (default) or skip and resolve to `undefined`. |

## Behaviour

- **CLOSED** — the method runs normally; failures (thrown errors) are counted.
- **OPEN** — the method is not executed. With a `fallback`, its value is returned; with `onOpen: 'skip'`, `undefined` is returned; otherwise `CircuitBreakerOpenError` is thrown.
- **HALF_OPEN** — a limited number of calls are allowed through as probes.

::: tip
The decorator throwing behaviour comes from the breaker rejecting the call. Recording of success/failure is automatic — a resolved method records success, a thrown error records failure.
:::

::: warning
If the plugin has not finished initializing (no service available yet), the method runs **without** the breaker and a warning is logged — calls are never blocked by a missing breaker.
:::
