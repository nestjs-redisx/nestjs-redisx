---
title: 'Dedup Plugin | NestJS RedisX'
description: 'Event deduplication for NestJS over Redis: first-wins TTL markers, the @Dedupe decorator, and a distributed trailing debounce.'
---

# Dedup Plugin

Run webhooks, queue messages, and user actions **once per window across the fleet**.

## Overview

Webhook providers redeliver. Queues are at-least-once. Users double-click. `@nestjs-redisx/dedup` gives you an atomic "have I seen this key in the last N seconds?" — one `SET NX PX` per check — plus a distributed trailing debounce for collapsing bursts into a single execution.

**Dedup vs idempotency**: this plugin is a lightweight first-wins *marker* — nothing about the execution is stored or replayed. If the caller needs the original *response* back (HTTP retries of a payment request), use [`@nestjs-redisx/idempotency`](/en/reference/idempotency/), which fingerprints requests and replays results.

## Key Features

- **First-wins markers** — exactly one winner per key per window, fleet-wide, in a single atomic operation
- **Failures don't burn the window** — a thrown first execution releases its own marker (CAS on the owner token), so retries aren't locked out until the TTL
- **Distributed trailing debounce** — a burst of calls collapses into one execution after the quiet window, on the instance that made the LAST call
- **`@Dedupe`** — proxy-based decorator for any `@Injectable` method with `{n}` key templates
- **`errorPolicy`** — gates fail open (default: run, duplicates possible during an outage) or closed (skip + throw); manual APIs are always strict
- **Testable without Redis** — runs on the [in-memory testing driver](/en/reference/testing/)

## Installation

::: code-group

```bash [ioredis]
npm install @nestjs-redisx/core @nestjs-redisx/dedup ioredis
```

```bash [node-redis]
npm install @nestjs-redisx/core @nestjs-redisx/dedup redis
```

:::

## Quick Start

<<< @/apps/demo/src/plugins/dedup/basic.setup.ts{typescript}

Deduplicate a webhook:

<<< @/apps/demo/src/plugins/dedup/decorator.usage.ts{typescript}

## How It Works

- `isFirst` / `dedupe` set a marker key (`SET NX PX`) holding this caller's token; only the caller that created the key is "first".
- When a `dedupe` execution **throws**, the marker is released via a CAS Lua script keyed on the token — a newer marker set by someone else is never erased.
- `debounce` stamps the caller as the LAST one for the key, waits out the quiet window in-process (unref'd timer), then atomically claims the slot — only the still-last caller executes.

## Next Steps

- [Configuration](/en/reference/dedup/configuration) — windows, errorPolicy, prefixes
- [Service API](/en/reference/dedup/service-api) — isFirst / dedupe / debounce / release
- [@Dedupe](/en/reference/dedup/decorator) — decorator options
- [Recipes](/en/reference/dedup/recipes) — webhooks, queue consumers, double-click guards, burst collapsing
- [Testing](/en/reference/dedup/testing) — no-Redis test setups
- [Troubleshooting](/en/reference/dedup/troubleshooting)
