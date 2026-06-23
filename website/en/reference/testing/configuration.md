---
title: 'Configuration Reference — Testing Utilities | NestJS RedisX'
description: 'Configure the in-memory Redis driver for NestJS RedisX tests — the RedisTestingModule wrapper, the global.driver option, and IMemoryDriverOptions.'
---

# Configuration

There are two ways to run your plugins against the in-memory driver.

## Option 1 — `RedisTestingModule` (recommended)

The wrapper forces the in-memory driver and fills in the (ignored) connection
config for you. Register the same plugins you use in production:

<<< @/apps/demo/src/plugins/testing/redis-testing-module.setup.ts{typescript}

`RedisTestingModule.forRootAsync(...)` is also available and mirrors
`RedisModule.forRootAsync` — its `useFactory` may omit `clients`.

## Option 2 — `global.driver` on `RedisModule`

If you prefer to configure `RedisModule` directly, import the package once (to
register the driver) and set `global.driver`:

<<< @/apps/demo/src/plugins/testing/in-memory-driver.setup.ts{typescript}

::: tip
Importing `@nestjs-redisx/testing` anywhere registers the `'memory'` driver as a
side effect. The `clients` block is still required by `RedisModule`, but its
`host`/`port` are never used — the in-memory driver does not connect.
:::

## Manual registration

The driver is registered automatically on import, but you can call the function
explicitly (it is idempotent):

```typescript
import { registerMemoryDriver } from '@nestjs-redisx/testing';

registerMemoryDriver();
```

This plugs into the core driver registry, so any
`RedisModule.forRoot({ global: { driver: 'memory' } })` — across the whole app —
can construct it.

## Driver options

`IMemoryDriverOptions` are passed through the standard driver factory options.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enableLogging` | `boolean` | `false` | Inherited driver operation logging. |
| `seed` | `Record<string, string>` | — | Reserved for seeding string keys (see [Testing Plugins](./testing-plugins) for the `getStore()` approach available today). |

## Isolation between tests

Each `MemoryRedisAdapter` instance owns a private keyspace. A fresh Nest context
(per test or per suite) starts empty. To reset state within a single context, use
the store directly — see [Testing Plugins → Seeding and inspecting state](./testing-plugins#seeding-and-inspecting-state).
