---
title: 'Overview — @nestjs-redisx/testing | NestJS RedisX'
description: 'Unit-test NestJS RedisX code without a running Redis. An in-memory driver runs the real cache, locks, rate-limit, idempotency, and streams plugins — including their Lua scripts and consumer groups — entirely in memory.'
---

# Testing Utilities

An in-memory Redis driver for unit-testing NestJS RedisX code — **no Redis required**.

## Overview

`@nestjs-redisx/testing` provides a drop-in `'memory'` driver that implements the
same `IRedisDriver` contract as the ioredis and node-redis adapters. Your plugins
(`CachePlugin`, `LocksPlugin`, `RateLimitPlugin`, `IdempotencyPlugin`, `StreamsPlugin`)
run with their **real production code** — including their Lua scripts and stream
consumer groups — against an in-memory keyspace. Tests stay fast, deterministic,
and isolated.

| Concern | Real Redis in tests | `@nestjs-redisx/testing` |
|---------|---------------------|--------------------------|
| Infrastructure | Container / service required | None — pure in-memory |
| Speed | Network round-trips | Synchronous, microsecond |
| Isolation | Shared keyspace, flush needed | Fresh keyspace per driver |
| Lua scripts | Run on Redis | Run on a built-in interpreter |
| Determinism | Time/ordering quirks | Fully controllable |

## Key Features

- **Real plugin behavior** — exercises the actual cache/locks/rate-limit/idempotency/streams code paths, not mocks.
- **Lua execution** — a small, in-house Lua interpreter runs the plugins' atomic scripts (token bucket, lock release, etc.).
- **Zero dependencies** — no third-party Redis mock; nothing extra in your runtime.
- **Same `IRedisDriver`** — strings, hashes, sets, sorted sets, lists, keys/TTL, and scripting.
- **Drop-in** — switch the driver with one option, or use the `RedisTestingModule` wrapper.

## Installation

```bash
npm install -D @nestjs-redisx/testing
```

It is a `devDependency` — the in-memory driver is only for tests.

## Quick Start

Use the `RedisTestingModule` wrapper to force the in-memory driver and register
the same plugins you use in production:

<<< @/apps/demo/src/plugins/testing/redis-testing-module.setup.ts{typescript}

Then boot a Nest context and assert on the **real** service behavior:

<<< @/apps/demo/src/plugins/testing/bootstrap-and-assert.usage.ts{typescript}

## How It Works

```mermaid
graph LR
    Test[Your test] --> Plugin[Real Plugin code]
    Plugin --> Driver[IRedisDriver]
    Driver -->|"global.driver = 'memory'"| Mem[MemoryRedisAdapter]
    Mem --> Store[(In-memory keyspace)]
    Mem --> Lua[Lua interpreter]
    Lua --> Store
```

The plugins are **driver-agnostic** — they only depend on `IRedisDriver`. Selecting
the `'memory'` driver swaps the transport; everything above it is unchanged.

## When to Use It — and When to Use Real Redis

The in-memory driver answers **"is my code correct?"** — fast, on every commit,
with no infrastructure. It is **not** a full Redis emulator: questions about
Redis's *own* behavior still belong in integration tests against a real Redis.

| ✅ Test with the in-memory driver | 🔺 Test against real Redis |
|---|---|
| Cache hit/miss, TTL, stampede, tag invalidation | Cluster cross-slot routing & hash-tag correctness |
| Lock acquisition / contention / release | Redis Pub/Sub fan-out across connections |
| Rate-limit algorithms (token bucket, windows) | Sentinel failover & reconnection behavior |
| Idempotency check-and-lock, replay, fingerprint | Real network latency / throughput / load |
| Streams produce → consumer group → ack / claim | Exact `BLOCK` timeout / long-poll timing |

::: warning Known limitations
Be aware of what the in-memory driver intentionally does **not** simulate:

- **Single-node semantics** — one keyspace; no `SELECT`, no cluster cross-slot (`CROSSSLOT`) checks or hash-tag routing. A missing hash-tag bug passes in-memory but can fail on a real cluster.
- **No Pub/Sub** — Redis publish/subscribe is not implemented (the plugins do not rely on it for their core logic).
- **Blocking reads return promptly** — `BLOCK` on `XREADGROUP`/`XREAD` does not wait the full timeout. Delivery is still correct; only the timing differs.
- **Correctness tool, not a performance simulator** — don't use it for load or latency testing.
- **Unsupported commands fail loudly** — an unimplemented command throws `MemoryDriverError` instead of silently returning a wrong result.

For any of the above, use a real Redis — the project ships integration test configs for **standalone**, **Sentinel**, and **Cluster**.
:::

## Documentation

| Topic | Description |
|-------|-------------|
| [Configuration](./configuration) | Driver selection, `RedisTestingModule`, and options |
| [In-Memory Driver](./memory-driver) | Supported commands, the Lua subset, and limitations |
| [Testing Plugins](./testing-plugins) | Patterns for cache, locks, rate-limit, idempotency, streams |
| [Troubleshooting](./troubleshooting) | Common errors and how to resolve them |
