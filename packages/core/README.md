<p align="center">
  <img src="https://raw.githubusercontent.com/nestjs-redisx/nestjs-redisx/main/website/public/images/logo.png" alt="NestJS RedisX" />
</p>

# @nestjs-redisx/core

[![npm](https://img.shields.io/npm/v/@nestjs-redisx/core)](https://www.npmjs.com/package/@nestjs-redisx/core)
[![npm downloads](https://img.shields.io/npm/dm/@nestjs-redisx/core)](https://www.npmjs.com/package/@nestjs-redisx/core)
[![license](https://img.shields.io/npm/l/@nestjs-redisx/core)](https://opensource.org/licenses/MIT)

Core module for NestJS RedisX. Provides `RedisModule` with driver abstraction, multi-client support, plugin system, and error hierarchy. This package is required by all other `@nestjs-redisx/*` plugins.

## Installation

```bash
npm install @nestjs-redisx/core ioredis
```

## Quick Example

```typescript
import { Module, Injectable } from '@nestjs/common';
import { RedisModule, RedisService } from '@nestjs-redisx/core';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
    }),
  ],
})
export class AppModule {}

@Injectable()
export class AppService {
  constructor(private readonly redis: RedisService) {}

  async ping(): Promise<string> {
    const client = await this.redis.getClient();
    return client.ping();
  }
}
```

## Documentation

Full documentation: [nestjs-redisx.dev/en/reference/core/](https://nestjs-redisx.dev/en/reference/core/)

## License

MIT
