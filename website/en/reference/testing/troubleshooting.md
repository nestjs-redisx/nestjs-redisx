---
title: 'Troubleshooting — Testing Utilities | NestJS RedisX'
description: 'Resolve common issues with the in-memory Redis driver for NestJS RedisX tests: unsupported driver type, unimplemented commands, and Lua execution errors.'
---

# Troubleshooting

## `Unsupported driver type: memory`

The driver was not registered before `RedisModule` constructed it. Importing the
package registers it as a side effect, so ensure `@nestjs-redisx/testing` is
imported in the test (the `RedisTestingModule` wrapper does this for you), or call
`registerMemoryDriver()` explicitly:

```typescript
import { registerMemoryDriver } from '@nestjs-redisx/testing';
registerMemoryDriver();
```

## `In-memory driver does not implement command: XYZ`

The code under test issued a command outside the [supported set](./memory-driver#supported-commands).
This is intentional — the driver fails loudly rather than returning a wrong
result. The cache, locks, rate-limit, idempotency, and streams plugins all stay
within the supported set; if you hit this with one of them, please open an issue.

## `Lua execution error: …`

A Lua script used a construct outside the [supported subset](./memory-driver#lua-scripting)
(for example `string.*`, `cjson`, `while`, or closures). The plugins' shipped
scripts stay within the subset; this usually means a custom script. Rewrite it
within the bounded subset, or run that particular test against a real Redis.

## Results differ from real Redis

The in-memory driver implements standard single-node semantics. If you rely on
cluster cross-slot behavior or Pub/Sub, use a real Redis for those tests — the
in-memory driver targets correctness for the data-structure, scripting, and
stream consumer-group paths the plugins use. Note that `BLOCK` on
`XREADGROUP`/`XREAD` returns promptly rather than waiting the full timeout.

## State leaks between tests

Each Nest context owns a private keyspace, so a fresh context per test is fully
isolated. Within one context, reset state via the store:

```typescript
(app.get(REDIS_DRIVER) as MemoryRedisAdapter).getStore().flush();
```
