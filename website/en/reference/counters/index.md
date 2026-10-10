---
title: 'Counters Plugin | NestJS RedisX'
description: 'Atomic counters for NestJS over Redis: fleet-wide increments, window counters with first-write TTL, atomic read-and-reset, and monotonic ID sequences.'
---

# Counters Plugin

Fleet-wide counters that **never lose updates**, windows that clean themselves up, and monotonic sequences.

## Overview

`this.views++` loses updates the moment you run two replicas. Redis `INCR` is the canonical fix — `@nestjs-redisx/counters` wraps it with validated inputs, window TTL semantics that actually behave (the first write opens the window, later writes never extend it), atomic read-and-reset for batch flushes, and loud failures on poisoned keys instead of silent `NaN`.

## Key Features

- **Atomic everywhere** — every mutation is one Redis operation; concurrent increments from any number of instances all count
- **Window counters** — `increment(key, 1, { ttl })` applies the TTL only when the increment *creates* the key: `api:${userId}:${today}` expires on its own
- **`getAndReset`** — read the accumulated total and zero it in one atomic step
- **Sequences** — `next('seq:invoices')` issues 1, 2, 3… across the whole fleet
- **Strict by design** — amounts must be non-zero safe integers; a non-numeric key throws `CounterValueError` instead of poisoning aggregates with `NaN`
- **Testable without Redis** — runs on the [in-memory testing driver](/en/reference/testing/)

## Installation

::: code-group

```bash [ioredis]
npm install @nestjs-redisx/core @nestjs-redisx/counters ioredis
```

```bash [node-redis]
npm install @nestjs-redisx/core @nestjs-redisx/counters redis
```

:::

## Quick Start

<<< @/apps/demo/src/plugins/counters/basic.setup.ts{typescript}

<<< @/apps/demo/src/plugins/counters/service.usage.ts{typescript}

## When NOT to Use Counters

- **Enforcing request rates** — that's the [rate limiter](/en/reference/rate-limit/) (token bucket / sliding window are more than a counter).
- **Bounding concurrency** — that's the [semaphore](/en/reference/semaphore/).
- **Prometheus metrics** — counters here are *domain state* (quotas, stock, sequences); operational telemetry belongs to the [metrics plugin](/en/reference/metrics/).

## Next Steps

- [Configuration](/en/reference/counters/configuration)
- [Service API](/en/reference/counters/service-api)
- [Recipes](/en/reference/counters/recipes) — usage quotas, batch flushes, live stats, ID generation
- [Testing](/en/reference/counters/testing)
- [Troubleshooting](/en/reference/counters/troubleshooting)
