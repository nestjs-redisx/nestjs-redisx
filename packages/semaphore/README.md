# @nestjs-redisx/semaphore

Distributed counting semaphore plugin for [NestJS RedisX](https://nestjs-redisx.dev) — bound concurrency **across instances**: at most N concurrent executions fleet-wide, with permit leases, auto-renewal, and a one-line decorator.

## Why

A local `p-limit` bounds one process. In a 10-replica deployment "at most 3 concurrent PDF renders" or "at most 5 open connections to the legacy API" needs a shared ceiling. This plugin keeps the count in Redis: every holder owns a leased permit that expires if the holder crashes, so seats never leak.

- **Permit leases** — a crashed holder frees its seat after the TTL; no background sweeper (expired permits are swept atomically inside acquire).
- **Auto-renewal** — long-running work keeps its seat; renewal stops the moment the permit is lost.
- **`@WithSemaphore`** — proxy-based decorator for any `@Injectable` method, with `{n}` key templates and an `onUnavailable` policy (`throw` | `skip` | custom error).
- **Graceful shutdown** — held permits are released on `app.close()`, so waiters take over immediately instead of after the TTL.
- **Cluster-safe** — one key per semaphore, no hash tags needed; works on the in-memory testing driver (real Lua, no Redis in unit CI).

## Install

```bash
npm install @nestjs-redisx/core @nestjs-redisx/semaphore ioredis
```

## Quick start

```typescript
import { Module, Injectable } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { SemaphorePlugin, WithSemaphore } from '@nestjs-redisx/semaphore';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: { type: 'single', host: 'localhost', port: 6379 },
      plugins: [new SemaphorePlugin()],
    }),
  ],
})
export class AppModule {}

@Injectable()
export class ReportService {
  // At most 3 concurrent renders across EVERY instance
  @WithSemaphore({ key: 'reports:render', permits: 3, ttl: 120_000 })
  async render(reportId: string) {
    // ...
  }
}
```

Service API:

```typescript
import { Inject, Injectable } from '@nestjs/common';
import { SEMAPHORE_SERVICE, type ISemaphoreService } from '@nestjs-redisx/semaphore';

@Injectable()
export class ImportService {
  constructor(@Inject(SEMAPHORE_SERVICE) private readonly semaphore: ISemaphoreService) {}

  async import(file: string) {
    return this.semaphore.withPermit('imports', 2, async () => {
      // at most 2 concurrent imports fleet-wide
      return this.process(file);
    });
  }
}
```

## Documentation

Full reference: <https://nestjs-redisx.dev/en/reference/semaphore/>

## License

MIT
