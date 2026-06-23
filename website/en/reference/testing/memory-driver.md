---
title: 'In-Memory Driver — Testing Utilities | NestJS RedisX'
description: 'What the in-memory Redis driver supports: string, hash, set, sorted-set, and list commands, keys/TTL, and a bounded Lua interpreter for the plugins atomic scripts.'
---

# In-Memory Driver

`MemoryRedisAdapter` extends the same `BaseRedisDriver` as the production
adapters, implementing its five primitives (`doConnect`, `doDisconnect`,
`executeCommand`, `createPipeline`, `createMulti`) over an in-memory keyspace.
The other ~180 driver methods are inherited unchanged.

## Supported commands

| Group | Commands |
|-------|----------|
| Strings | `GET`, `SET` (`EX`/`PX`/`NX`/`XX`/`GET`), `SETEX`, `SETNX`, `APPEND`, `STRLEN`, `INCR`, `INCRBY`, `DECR`, `DECRBY`, `MGET`, `MSET` |
| Keys / TTL | `DEL`, `UNLINK`, `EXISTS`, `EXPIRE`, `PEXPIRE`, `EXPIREAT`, `PEXPIREAT`, `PERSIST`, `TTL`, `PTTL`, `TYPE`, `KEYS`, `SCAN` |
| Hashes | `HSET`, `HMSET`, `HGET`, `HMGET`, `HGETALL`, `HDEL`, `HEXISTS`, `HLEN`, `HKEYS`, `HVALS`, `HINCRBY` |
| Sets | `SADD`, `SREM`, `SMEMBERS`, `SISMEMBER`, `SCARD` |
| Sorted sets | `ZADD`, `ZREM`, `ZCARD`, `ZSCORE`, `ZRANGE`, `ZRANGEBYSCORE`, `ZREMRANGEBYSCORE`, `ZCOUNT` |
| Lists | `LPUSH`, `RPUSH`, `LPOP`, `RPOP`, `LLEN`, `LRANGE`, `LINDEX`, `LREM` |
| Scripting | `EVAL`, `EVALSHA`, `SCRIPT LOAD` |
| Server | `PING`, `DBSIZE`, `FLUSHDB`, `FLUSHALL` |

This set covers everything the **cache, locks, rate-limit, and idempotency**
plugins use. TTL is enforced with lazy expiry: an expired key is evicted the next
time it is read.

## Lua scripting

The plugins rely on Lua scripts for atomicity (e.g. token-bucket rate limiting,
owner-checked lock release). The in-memory driver runs them on a small in-house
interpreter — no third-party engine. `redis.call(...)` re-enters the same
executor, so a script sees a consistent, single-threaded view, exactly like Redis.

The interpreter supports the bounded subset the project's scripts use:

- `KEYS` / `ARGV`, `local` variables, assignment, and table indexing
- `redis.call` / `redis.pcall` (over the supported command set above)
- `if` / `elseif` / `else`, numeric `for` loops (with optional step)
- arithmetic (`+ - * / %`), comparison, logical `and` / `or` / `not`, concat `..`
- `#` length, `tonumber`, `tostring`, `math.floor` / `ceil` / `abs` / `min` / `max`
- array + hashmap tables (`HGETALL` is flattened to a `[field, value, …]` array, as on Redis)

Anything outside this subset (e.g. `string.*`, `cjson`, `while`, closures) raises
a `LuaExecutionError` rather than returning a silently wrong result.

## Limitations

- **Phase 1 scope** — Streams (`XADD`/`XREADGROUP`/…) are not yet implemented, so the Streams plugin is out of scope for now.
- **Single keyspace** — no multi-database (`SELECT`) or cross-slot cluster semantics; behavior matches a single standalone Redis.
- **Not for load testing** — it is a correctness tool for unit tests, not a performance simulator.
- **Unsupported commands fail loudly** — calling a command the driver does not implement throws `MemoryDriverError`, surfacing gaps instead of hiding them.

## Direct use

You can construct the adapter directly when you need a driver without Nest:

```typescript
import { MemoryRedisAdapter } from '@nestjs-redisx/testing';

const driver = new MemoryRedisAdapter({ type: 'single', host: 'x', port: 1 });
await driver.connect();

await driver.set('k', 'v');
await driver.get('k'); // 'v'
```
