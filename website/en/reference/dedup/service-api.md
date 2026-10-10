---
title: 'Dedup Service API | NestJS RedisX'
description: 'IDedupService: isFirst, dedupe, debounce, release - strict manual APIs, policy-driven gates, and failure semantics.'
---

# Service API

Inject with the `DEDUP_SERVICE` token:

<<< @/apps/demo/src/plugins/dedup/service.usage.ts{typescript}

## `IDedupService`

| Method | Kind | Description |
|--------|------|-------------|
| `isFirst(key, options?)` | strict | Atomically mark-and-check; `true` exactly once per window across all instances |
| `dedupe(key, fn, options?)` | gate | Run `fn` for the first occurrence only; duplicates resolve `undefined` |
| `debounce(key, fn, options?)` | gate | Run `fn` once the key goes quiet for the window, on the LAST caller |
| `release(key)` | strict | Remove a marker early (support tooling, forced retry) |

**strict** = store failures always throw `DedupStoreError`. **gate** = store failures follow the plugin [`errorPolicy`](/en/reference/dedup/configuration#errorpolicy-choosing-a-failure-direction).

## `dedupe` failure semantics

A **thrown** first execution releases its own marker (CAS on the caller token - a marker set by a newer first is never erased), so the provider's retry can run instead of being locked out for the window:

```
attempt 1: markFirst ✓ → fn() throws → marker released → error propagates
attempt 2 (retry): markFirst ✓ → fn() succeeds
attempt 3 (duplicate): markFirst ✗ → undefined
```

A **crash** (no throw path) leaves the marker until the TTL - at-most-once within the window is preserved.

## `debounce` semantics

<<< @/apps/demo/src/plugins/dedup/debounce.usage.ts{typescript}

- Every call overwrites the shared "last caller" slot and waits the window **in-process** (the returned promise settles after the quiet period).
- When the window elapses, the caller atomically claims the slot - only the one that is *still* last executes; superseded calls resolve `undefined`.
- A slot that **expired before the claim** (the process stalled past the ~5s grace) is a **lost round**: the call resolves `undefined` and a distinct warning is logged - never silently conflated with supersession.
- The pending timer is unref'd and lives in the last caller's process: if that instance dies before the window elapses, the round does not execute (best-effort, exactly like an in-process debounce - the next call starts a new round).

## Metrics

With the [Metrics plugin](/en/reference/metrics/):

| Metric | Type | Labels |
|--------|------|--------|
| `redisx_dedup_checks_total` | counter | `outcome` = `first` \| `duplicate` |
