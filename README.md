<p align="center">
  <img src="https://raw.githubusercontent.com/nestjs-redisx/nestjs-redisx/main/website/public/images/logo.png" alt="NestJS RedisX" />
</p>

<h1 align="center">NestJS RedisX</h1>

<p align="center">Modular Redis toolkit for NestJS with plugin architecture</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@nestjs-redisx/core"><img src="https://img.shields.io/npm/v/@nestjs-redisx/core" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@nestjs-redisx/core"><img src="https://img.shields.io/npm/dm/@nestjs-redisx/core" alt="npm downloads" /></a>
  <a href="https://github.com/nestjs-redisx/nestjs-redisx/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/nestjs-redisx/nestjs-redisx/ci.yml" alt="CI" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/npm/l/@nestjs-redisx/core" alt="license" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/node/v/@nestjs-redisx/core" alt="node version" /></a>
  <a href="https://codecov.io/gh/nestjs-redisx/nestjs-redisx"><img src="https://codecov.io/gh/nestjs-redisx/nestjs-redisx/graph/badge.svg" alt="codecov" /></a>
</p>

<p align="center">
  <a href="https://nestjs-redisx.dev">Documentation</a> &#8226;
  <a href="https://nestjs-redisx.dev/en/guide/">Getting Started</a> &#8226;
  <a href="https://nestjs-redisx.dev/en/reference/core/">API Reference</a> &#8226;
  <a href="https://github.com/nestjs-redisx/nestjs-redisx/discussions">Discussions</a>
</p>

## Who is this for

- Replace `cache-manager` with production-grade L1+L2 caching, stampede protection, and tag invalidation
- Need distributed locks, rate limiting, and idempotency in one ecosystem instead of 5 separate libraries
- Need Prometheus metrics and OpenTelemetry tracing for Redis operations out of the box
- Building multi-tenant NestJS apps that need cache isolation per tenant
- Migrating from raw ioredis/node-redis and want NestJS-native DI integration

## Quality

- 2k+ tests across unit, integration, and E2E
- Coverage tracked via [Codecov](https://codecov.io/gh/nestjs-redisx/nestjs-redisx)
- Pack-test validates every package installs and works from tarball
- Compatibility tested across Node 18/20, NestJS 10/11, Redis 6.2/7.x

[Testing details](https://nestjs-redisx.dev/en/guide/operations/testing-overview/) | [Compatibility matrix](https://nestjs-redisx.dev/en/guide/operations/compatibility/)

## Features

| | Feature | What you get |
|---|---|---|
| **Cache** | Two-Tier Cache | L1 memory + L2 Redis with anti-stampede, SWR, and tag invalidation |
| **Locks** | Distributed Locks | Redis-based locking with auto-renewal and retry strategies |
| **Rate Limit** | Rate Limiting | Fixed window, sliding window, and token bucket algorithms |
| **Idempotency** | Request Idempotency | Deduplication with fingerprinting and response replay |
| **Streams** | Redis Streams | Consumer groups, dead-letter queues, and backpressure |
| **Metrics** | Prometheus Metrics | Command latencies, cache hit rates, and custom metrics |
| **Tracing** | OpenTelemetry Tracing | Distributed tracing with Jaeger/Zipkin/OTLP export |

## Quick Start

```bash
npm install @nestjs-redisx/core @nestjs-redisx/cache ioredis
```

```typescript
import { RedisModule } from '@nestjs-redisx/core';
import { CachePlugin, Cached } from '@nestjs-redisx/cache';
import { ConfigModule, ConfigService } from '@nestjs/config';

// 1. Register
@Module({
  imports: [
    RedisModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      plugins: [
        CachePlugin.registerAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            l1: { maxSize: config.get('CACHE_L1_MAX_SIZE', 1000) },
            l2: { defaultTtl: config.get('CACHE_L2_TTL', 3600) },
          }),
        }),
      ],
      useFactory: (config: ConfigService) => ({
        clients: {
          host: config.get('REDIS_HOST', 'localhost'),
          port: config.get('REDIS_PORT', 6379),
        },
      }),
    }),
  ],
})
export class AppModule {}

// 2. Use
@Injectable()
export class UserService {
  @Cached({ key: 'user:{0}', ttl: 300, tags: ['users'] })
  async getUser(id: string) { return this.repo.findById(id); }
}
```

## Plugins

| Plugin | Description | Version |
|--------|-------------|---------|
| [@nestjs-redisx/core](https://nestjs-redisx.dev/en/reference/core/) | Driver abstraction, plugin system, multi-client support | [![npm](https://img.shields.io/npm/v/@nestjs-redisx/core)](https://www.npmjs.com/package/@nestjs-redisx/core) |
| [@nestjs-redisx/cache](https://nestjs-redisx.dev/en/reference/cache/) | L1+L2 caching with SWR, stampede protection, tags | [![npm](https://img.shields.io/npm/v/@nestjs-redisx/cache)](https://www.npmjs.com/package/@nestjs-redisx/cache) |
| [@nestjs-redisx/locks](https://nestjs-redisx.dev/en/reference/locks/) | Distributed locks with auto-renewal | [![npm](https://img.shields.io/npm/v/@nestjs-redisx/locks)](https://www.npmjs.com/package/@nestjs-redisx/locks) |
| [@nestjs-redisx/rate-limit](https://nestjs-redisx.dev/en/reference/rate-limit/) | Multi-algorithm rate limiting | [![npm](https://img.shields.io/npm/v/@nestjs-redisx/rate-limit)](https://www.npmjs.com/package/@nestjs-redisx/rate-limit) |
| [@nestjs-redisx/idempotency](https://nestjs-redisx.dev/en/reference/idempotency/) | Request deduplication and response replay | [![npm](https://img.shields.io/npm/v/@nestjs-redisx/idempotency)](https://www.npmjs.com/package/@nestjs-redisx/idempotency) |
| [@nestjs-redisx/streams](https://nestjs-redisx.dev/en/reference/streams/) | Redis Streams with consumer groups and DLQ | [![npm](https://img.shields.io/npm/v/@nestjs-redisx/streams)](https://www.npmjs.com/package/@nestjs-redisx/streams) |
| [@nestjs-redisx/metrics](https://nestjs-redisx.dev/en/reference/metrics/) | Prometheus metrics for Redis operations | [![npm](https://img.shields.io/npm/v/@nestjs-redisx/metrics)](https://www.npmjs.com/package/@nestjs-redisx/metrics) |
| [@nestjs-redisx/tracing](https://nestjs-redisx.dev/en/reference/tracing/) | OpenTelemetry distributed tracing | [![npm](https://img.shields.io/npm/v/@nestjs-redisx/tracing)](https://www.npmjs.com/package/@nestjs-redisx/tracing) |

## Comparison

|  | RedisX | @nestjs/cache-manager | @liaoliaots/nestjs-redis | ioredis |
|--|:------:|:---------------------:|:------------------------:|:-------:|
| L1+L2 Cache | **Yes** | - | - | - |
| Stampede Protection | **Yes** | - | - | - |
| Distributed Locks | **Yes** | - | - | Manual |
| Rate Limiting | **Yes** | - | - | - |
| Idempotency | **Yes** | - | - | - |
| Prometheus + OTel | **Yes** | - | - | - |

[Full comparison](https://nestjs-redisx.dev/en/#ecosystem-comparison)

## Documentation

Full documentation, guides, and API reference at **[nestjs-redisx.dev](https://nestjs-redisx.dev)**.

## Sponsors

NestJS RedisX is free and open source. Development is supported by the community.

[Become a Sponsor](https://github.com/sponsors/sur-ser)

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

[MIT](./LICENSE)
