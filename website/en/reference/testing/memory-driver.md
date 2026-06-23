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
| Streams | `XADD` (`NOMKSTREAM`/`MAXLEN`/`MINID`), `XLEN`, `XRANGE`, `XREVRANGE`, `XDEL`, `XTRIM`, `XINFO STREAM`, `XGROUP` (`CREATE`/`DESTROY`/`SETID`/`DELCONSUMER`), `XREADGROUP`, `XREAD`, `XACK`, `XPENDING`, `XCLAIM` |
| Scripting | `EVAL`, `EVALSHA`, `SCRIPT LOAD` |
| Server | `PING`, `DBSIZE`, `FLUSHDB`, `FLUSHALL` |

This set covers everything the **cache, locks, rate-limit, idempotency, and
streams** plugins use. TTL is enforced with lazy expiry: an expired key is
evicted the next time it is read.

### Streams and consumer groups

Streams are modelled with real consumer-group semantics: monotonic `<ms>-<seq>`
ids, per-group delivery cursors, per-consumer pending-entries lists (PEL),
delivery counts, and idle-time tracking. So `XREADGROUP ... >` delivers only
never-seen entries and records them in the PEL; `XACK` clears them; `XPENDING`
and `XCLAIM` let another consumer reclaim idle messages — exactly what the
Streams plugin's consumer loop and auto-claim rely on.

The in-memory driver never truly blocks. A blocking `XREADGROUP`/`XREAD` that
finds nothing returns `null` after a short delay (instead of waiting the full
`BLOCK` timeout), which keeps a background consumer poll loop responsive without
starving the event loop.

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

- **No real blocking** — `BLOCK` on `XREADGROUP`/`XREAD` returns promptly instead of waiting; Pub/Sub is not implemented.
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
