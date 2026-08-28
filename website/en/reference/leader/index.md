---
title: 'Leader Election Plugin | NestJS RedisX'
description: 'Leader election for NestJS over Redis: run cron jobs, migrations, and cleanup on exactly one instance with @LeaderOnly, lease heartbeats, and automatic failover.'
---

# Leader Election Plugin

Run singleton work — cron jobs, migrations, cleanup — on **exactly one instance** of your fleet.

## Overview

Every multi-instance NestJS deployment hits the same problem: `@Cron` fires on every replica. Emails go out twice, cleanup jobs race, migrations collide. `@nestjs-redisx/leader` elects one leader per group over a Redis lease and gives you a one-line decorator to gate singleton work.

## Key Features

- **`@LeaderOnly()` decorator** — proxy-based, works on any `@Injectable` method; composes with `@nestjs/schedule` (`@Cron` fires everywhere, the body runs only on the leader)
- **Lease-based election** — `SET NX PX` acquire, CAS Lua heartbeat, CAS release; single-key and cluster-safe
- **Automatic failover** — instant on graceful shutdown (lease released), bounded by `ttlMs + retryIntervalMs` on a crash
- **Fail-safe local view** — `isLeader()` is true only while the last confirmed lease is unexpired
- **Independent groups** — separate elections per concern; decorator-referenced groups start automatically
- **Observability** — `onElected` / `onLost` callbacks and `redisx_leader_*` counters with the Metrics plugin

## Installation

::: code-group

```bash [ioredis]
npm install @nestjs-redisx/core @nestjs-redisx/leader ioredis
```

```bash [node-redis]
npm install @nestjs-redisx/core @nestjs-redisx/leader redis
```

:::

## Basic Configuration

<<< @/apps/demo/src/plugins/leader/basic.setup.ts{typescript}

## Usage with @Cron

<<< @/apps/demo/src/plugins/leader/leader-only-cron.usage.ts{typescript}

Start two copies of the app and watch exactly one of them run the job. When that copy stops or crashes, the other takes over automatically.

## Programmatic API

```typescript
import { LEADER_SERVICE, ILeaderService } from '@nestjs-redisx/leader';

constructor(@Inject(LEADER_SERVICE) private leader: ILeaderService) {}

this.leader.isLeader();                    // sync local view
await this.leader.getLeaderId();           // who leads (any instance)
await this.leader.runIfLeader(() => ...);  // gated execution
await this.leader.stepDown();              // hand leadership over
```

## Documentation

| Topic | Description |
|-------|-------------|
| [Core Concepts](./concepts) | The lease model, guarantees, and caveats |
| [Configuration](./configuration) | All plugin options |
| [@LeaderOnly Decorator](./decorator) | Gating methods by leadership |
| [Service API](./service-api) | Programmatic leadership checks |
| [Failover](./failover) | Timings for graceful shutdown, crash, and step-down |
| [Monitoring](./monitoring) | Metrics, callbacks, and status endpoints |
| [Testing](./testing) | Testing without Redis on the in-memory driver |
| [Recipes](./recipes) | Singleton crons, startup work, maintenance drains |
| [Troubleshooting](./troubleshooting) | Debugging common issues |
