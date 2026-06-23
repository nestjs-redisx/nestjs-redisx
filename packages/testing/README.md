<p align="center">
  <img src="https://raw.githubusercontent.com/nestjs-redisx/nestjs-redisx/main/website/public/images/logo.png" alt="NestJS RedisX" />
</p>

# @nestjs-redisx/testing

[![npm](https://img.shields.io/npm/v/@nestjs-redisx/testing)](https://www.npmjs.com/package/@nestjs-redisx/testing)
[![npm downloads](https://img.shields.io/npm/dm/@nestjs-redisx/testing)](https://www.npmjs.com/package/@nestjs-redisx/testing)
[![license](https://img.shields.io/npm/l/@nestjs-redisx/testing)](https://opensource.org/licenses/MIT)

Testing utilities for NestJS RedisX: an **in-memory Redis driver** that runs the real cache, locks, rate-limit, and idempotency plugins — including their Lua scripts — with no Redis required. Fast, deterministic, isolated unit tests.

## Installation

```bash
npm install -D @nestjs-redisx/testing
```

## Quick Example

```typescript
import { Test } from '@nestjs/testing';
import { RedisTestingModule } from '@nestjs-redisx/testing';
import { CachePlugin, CACHE_SERVICE, ICacheService } from '@nestjs-redisx/cache';

const app = await Test.createTestingModule({
  imports: [RedisTestingModule.forRoot({ plugins: [new CachePlugin()] })],
}).compile();
await app.init();

const cache = app.get<ICacheService>(CACHE_SERVICE);

let calls = 0;
const loader = async () => (calls++, { id: 1 });
await cache.getOrSet('user:1', loader, { ttl: 60 });
await cache.getOrSet('user:1', loader, { ttl: 60 });
// calls === 1 — real cache code, no Redis
```

Prefer to configure `RedisModule` directly? Import the package (to register the
driver) and set `global.driver`:

```typescript
import '@nestjs-redisx/testing';
import { RedisModule } from '@nestjs-redisx/core';

RedisModule.forRoot({
  clients: { type: 'single', host: 'localhost', port: 6379 }, // ignored
  global: { driver: 'memory' },
  plugins: [/* ... */],
});
```

## Scope

Supports the data structures and scripting used by the cache, locks, rate-limit,
idempotency, and streams plugins: strings, hashes, sets, sorted sets, lists,
streams (with consumer groups, PEL, `XACK`/`XCLAIM`/`XPENDING`), keys/TTL, and a
bounded Lua interpreter. Single-node semantics only — no cluster cross-slot or
Pub/Sub, and blocking reads return promptly rather than waiting.

## Documentation

Full documentation: [nestjs-redisx.dev/en/reference/testing/](https://nestjs-redisx.dev/en/reference/testing/)

## Using with AI Assistants

For better code generation with AI tools (Cursor, Claude Code, GitHub Copilot, etc.), point your agent to the full API reference:

```
https://nestjs-redisx.dev/llms-full.txt
```

## License

MIT
