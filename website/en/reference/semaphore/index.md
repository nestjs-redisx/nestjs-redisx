---
title: 'Semaphore Plugin | NestJS RedisX'
description: 'Distributed counting semaphore for NestJS over Redis: bound concurrency across instances with permit leases, auto-renewal, and the @WithSemaphore decorator.'
---

# Semaphore Plugin

Bound concurrency **across instances**: at most N concurrent executions fleet-wide.

## Overview

A local `p-limit` bounds one process. In a 10-replica deployment "at most 3 concurrent PDF renders" or "at most 5 open connections to the legacy API" needs a shared ceiling. `@nestjs-redisx/semaphore` keeps the count in Redis: every holder owns a **leased permit** that expires if the holder crashes, so seats never leak.

A lock is the special case `permits: 1` — if you need mutual exclusion with retries and auto-renewal, use [`@nestjs-redisx/locks`](/en/reference/locks/); a semaphore is for "at most N".

## Key Features

- **Permit leases** — one sorted set per semaphore (member = permit id, score = expiry); expired permits are swept atomically inside acquire, so a crashed holder frees its seat after the TTL with no background job
- **Auto-renewal** — long-running work keeps its seat; renewal stops the moment the permit is lost
- **`@WithSemaphore`** — proxy-based decorator for any `@Injectable` method with `{n}` key templates and an `onUnavailable` policy (`throw` | `skip` | custom error)
- **Honest shutdown** — `app.close()` never yanks a seat from under still-running work: renewal stops and seats lapse within their remaining TTL (the crash bound); work that finishes in time still releases instantly
- **Cluster-safe** — one key per semaphore, no hash tags needed
- **Testable without Redis** — the Lua scripts run byte-for-byte on the [in-memory testing driver](/en/reference/testing/)

## Installation

::: code-group

```bash [ioredis]
npm install @nestjs-redisx/core @nestjs-redisx/semaphore ioredis
```

```bash [node-redis]
npm install @nestjs-redisx/core @nestjs-redisx/semaphore redis
```

:::

## Quick Start

Register the plugin:

<<< @/apps/demo/src/plugins/semaphore/basic.setup.ts{typescript}

Bound a method:

<<< @/apps/demo/src/plugins/semaphore/decorator.usage.ts{typescript}

## How It Works

1. `acquire(key, permits)` runs one atomic Lua script: sweep expired permits → if fewer than `permits` live holders remain, add this permit with `score = now + ttl`.
2. While held, auto-renewal extends the score every `ttl × intervalFraction` (CAS: only an unexpired own permit can be extended).
3. `release()` removes the permit; a crash leaves it to expire — the next acquire sweeps it.
4. The semaphore key itself carries a `PEXPIRE` at least as long as its longest permit, so abandoned semaphores vanish on their own.
5. Every expiry decision uses the **Redis server clock** (a cached `TIME` offset, re-synced every 30s) — an instance with a skewed local clock cannot sweep other instances' live permits.

The **capacity travels with the call** (like rate-limit limits): every caller of a key must pass the same `permits` value — the store enforces whatever the acquiring call provides.

## Next Steps

- [Configuration](/en/reference/semaphore/configuration) — TTLs, retry backoff, auto-renewal
- [Service API](/en/reference/semaphore/service-api) — acquire / tryAcquire / withPermit / counts
- [@WithSemaphore](/en/reference/semaphore/decorator) — decorator options and policies
- [Recipes](/en/reference/semaphore/recipes) — worker pools, per-tenant bounds, protecting fragile dependencies
- [Testing](/en/reference/semaphore/testing) — real semaphores on the in-memory driver
- [Troubleshooting](/en/reference/semaphore/troubleshooting)
