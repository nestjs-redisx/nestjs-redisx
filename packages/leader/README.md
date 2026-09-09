# @nestjs-redisx/leader

Leader election plugin for [NestJS RedisX](https://nestjs-redisx.dev) — run cron jobs, migrations, and cleanup on **exactly one instance** of your fleet, with lease heartbeats and automatic failover.

## Why

Every multi-instance NestJS deployment hits the same problem: `@Cron` fires on every replica. Emails go out twice, cleanup jobs race, migrations collide. This plugin elects one leader per group over a Redis lease and gives you a one-line decorator to gate singleton work.

- **`@LeaderOnly()`** — proxy-based method decorator for regular methods (generators are rejected at class load); composes with `@nestjs/schedule` (`@Cron` fires everywhere, the body runs only on the leader)
- **Lease-based election** — atomic acquire (own-lease re-claim first, else `SET NX PX`), CAS Lua heartbeat, CAS release; single-key, cluster-safe
- **Automatic failover** — instant on graceful shutdown (lease released), bounded by `ttlMs + retryIntervalMs` on crash
- **Fail-safe local view** — `isLeader()` is true only while the last confirmed lease is unexpired; an unconfirmed renewal demotes immediately, and the still-held key is re-claimed on the next retry tick
- **Multiple independent groups** — `@LeaderOnly({ group: 'reports' })` registers its election automatically
- **Observability** — `onElected` / `onLost` callbacks and `redisx_leader_*` counters with the Metrics plugin

## Installation

```bash
npm install @nestjs-redisx/core @nestjs-redisx/leader ioredis
# or: npm install @nestjs-redisx/core @nestjs-redisx/leader redis
```

## Quick start

```typescript
import { Module, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RedisModule } from '@nestjs-redisx/core';
import { LeaderPlugin, LeaderOnly } from '@nestjs-redisx/leader';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
      plugins: [new LeaderPlugin()],
    }),
  ],
})
export class AppModule {}

@Injectable()
export class ReportJobs {
  @Cron(CronExpression.EVERY_HOUR)
  @LeaderOnly()
  async hourlyReport() {
    // Runs on exactly one instance of the fleet
  }
}
```

Programmatic API via `LEADER_SERVICE` (`ILeaderService`): `isLeader()`, `getLeaderId()`, `runIfLeader(fn)`, `stepDown()`, `getGroups()`, `instanceId`.

## Semantics to know

Leadership is a **lease, not a fence**: assume NTP-synced clocks and bounded event-loop pauses. For hard mutual exclusion inside leader work, combine with `@nestjs-redisx/locks`.

## Documentation

Full reference: https://nestjs-redisx.dev/en/reference/leader/

## License

MIT
