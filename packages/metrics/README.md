<p align="center">
  <img src="https://raw.githubusercontent.com/nestjs-redisx/nestjs-redisx/main/website/public/images/logo.png" alt="NestJS RedisX" />
</p>

# @nestjs-redisx/metrics

[![npm](https://img.shields.io/npm/v/@nestjs-redisx/metrics)](https://www.npmjs.com/package/@nestjs-redisx/metrics)
[![npm downloads](https://img.shields.io/npm/dm/@nestjs-redisx/metrics)](https://www.npmjs.com/package/@nestjs-redisx/metrics)
[![license](https://img.shields.io/npm/l/@nestjs-redisx/metrics)](https://opensource.org/licenses/MIT)

Prometheus metrics plugin for NestJS RedisX. Exposes Redis command latencies, connection pool stats, cache hit rates, and custom metrics via a `/metrics` endpoint. `prom-client` is bundled.

## Installation

```bash
npm install @nestjs-redisx/core @nestjs-redisx/metrics ioredis
```

## Quick Example

```typescript
import { RedisModule } from '@nestjs-redisx/core';
import { MetricsPlugin } from '@nestjs-redisx/metrics';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
      plugins: [
        new MetricsPlugin({ prefix: 'redisx_', exposeEndpoint: true }),
      ],
    }),
  ],
})
export class AppModule {}

// Scrape: curl http://localhost:3000/metrics
```

## Documentation

Full documentation: [nestjs-redisx.dev/en/reference/metrics/](https://nestjs-redisx.dev/en/reference/metrics/)

## License

MIT
