---
title: 'Semaphore Configuration | NestJS RedisX'
description: 'SemaphorePlugin options: permit TTLs, retry backoff, auto-renewal, key prefix, named clients, and async registration.'
---

# Configuration

## Plugin Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `client` | `string` | `'default'` | Named Redis client to use |
| `keyPrefix` | `string` | `'_sem:'` | Prefix for semaphore keys (must be non-empty) |
| `defaultTtl` | `number` | `30000` | Permit lease in ms — a crashed holder frees its seat after this |
| `maxTtl` | `number` | `300000` | Hard cap for `defaultTtl` and per-call `ttl` |
| `retry.maxRetries` | `number` | `3` | Retries after the initial acquire attempt |
| `retry.initialDelay` | `number` | `100` | First backoff delay in ms |
| `retry.maxDelay` | `number` | `3000` | Backoff ceiling in ms |
| `retry.multiplier` | `number` | `2` | Exponential backoff multiplier (≥ 1) |
| `autoRenew.enabled` | `boolean` | `true` | Renew held permits automatically |
| `autoRenew.intervalFraction` | `number` | `0.5` | Renewal interval as a fraction of the TTL (strictly between 0 and 1) |

All options are validated **fail-fast** at registration (and again in the service constructor for hand-wired setups): non-positive timings, `defaultTtl > maxTtl`, an interval fraction outside `(0, 1)`, or an empty `keyPrefix` throw `InvalidSemaphoreConfigError` before the application starts.

## Synchronous Setup

<<< @/apps/demo/src/plugins/semaphore/basic.setup.ts{typescript}

## Async Registration

Load configuration through NestJS DI (ConfigService, Vault, …):

<<< @/apps/demo/src/plugins/semaphore/register-async.setup.ts{typescript}

## Per-Call Options

Every acquisition can override the plugin defaults:

| Option | Description |
|--------|-------------|
| `ttl` | Permit TTL for this acquisition (capped at `maxTtl`) |
| `waitTimeout` | Total wait budget in ms — stop retrying once sleeping again would exceed it |
| `autoRenew` | Enable/disable renewal for this permit |
| `retry.maxRetries`, `retry.initialDelay` | Per-call retry overrides |

## Choosing the TTL

The TTL is the **crash-recovery bound**: a holder that dies without releasing blocks its seat for at most the remaining TTL. With auto-renewal on (default), pick a TTL comfortably above one renewal round-trip (seconds, not milliseconds) and let renewal carry long work. With auto-renewal off, the TTL must exceed your worst-case execution time.

## Capacity Discipline

`permits` is passed per call and must be **the same for every caller of a key**. The store enforces the capacity the acquiring call provides — two callers using different numbers for one key will observe the larger caller's view win whenever it acquires. Define the capacity once next to the key:

```typescript
export const RENDER_SEMAPHORE = { key: 'reports:render', permits: 3 } as const;
```
