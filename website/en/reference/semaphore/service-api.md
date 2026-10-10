---
title: 'Semaphore Service API | NestJS RedisX'
description: 'ISemaphoreService: acquire, tryAcquire, withPermit, usedPermits, availablePermits, forceReleaseAll — and the permit lifecycle.'
---

# Service API

Inject with the `SEMAPHORE_SERVICE` token:

<<< @/apps/demo/src/plugins/semaphore/service.usage.ts{typescript}

## `ISemaphoreService`

| Method | Description |
|--------|-------------|
| `acquire(key, permits, options?)` | Acquire a permit with exponential-backoff retry; throws `SemaphoreAcquisitionError` when the retry budget (or `waitTimeout`) runs out |
| `tryAcquire(key, permits, options?)` | One attempt; `null` when the semaphore is full |
| `withPermit(key, permits, fn, options?)` | Acquire → run → always release (even when `fn` throws) |
| `usedPermits(key)` | Live (unexpired) holders right now |
| `availablePermits(key, permits)` | `permits − used`, never below 0 |
| `forceReleaseAll(key)` | Admin: free every seat; returns how many were held |

## The Permit (`ISemaphorePermit`)

`acquire`/`tryAcquire` return a permit — a leased seat:

| Member | Description |
|--------|-------------|
| `key`, `permitId`, `ttl`, `acquiredAt`, `expiresAt` | Identity and lease window |
| `release()` | Free the seat. Idempotent. Throws `SemaphorePermitNotHeldError` when the seat was already lost (expired / force-released) — the bound was NOT held for the full duration |
| `extend(ttl)` | Push the expiry forward; `SemaphoreExtensionError` when the permit expired on the store |
| `isHeld()` | Live check against the store |
| `isAutoRenewing` / `stopAutoRenew()` | Renewal state and manual stop |

### Why `release()` can throw

A release that returns quietly after the seat already expired would hide a real incident: for some period the fleet ran **more** than `permits` concurrent executions. The error is your signal to raise the TTL or enable auto-renewal. `withPermit` logs this instead of throwing — the work already ran; the signal lands in the logs.

## Shutdown Semantics

On `app.close()` the service releases every permit this instance still holds, so waiting instances take over **immediately** instead of after the TTL. Permits released by your own `finally` blocks first are skipped (release is idempotent).

## Monitoring

<<< @/apps/demo/src/plugins/semaphore/monitoring.usage.ts{typescript}

With the [Metrics plugin](/en/reference/metrics/) registered, the service emits:

| Metric | Type | Labels |
|--------|------|--------|
| `redisx_semaphore_acquisitions_total` | counter | `status` = `acquired` \| `failed` |
| `redisx_semaphore_wait_duration_seconds` | histogram | — |
| `redisx_semaphore_hold_duration_seconds` | histogram | — (withPermit only) |
| `redisx_semaphore_permits_active` | gauge | — |

With the [Tracing plugin](/en/reference/tracing/), every `acquire` creates a `semaphore.acquire` span carrying the key, capacity, attempts, and outcome.
