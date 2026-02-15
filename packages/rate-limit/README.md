<p align="center">
  <img src="https://raw.githubusercontent.com/nestjs-redisx/nestjs-redisx/main/website/public/images/logo.png" alt="NestJS RedisX" />
</p>

# @nestjs-redisx/rate-limit

[![npm](https://img.shields.io/npm/v/@nestjs-redisx/rate-limit)](https://www.npmjs.com/package/@nestjs-redisx/rate-limit)
[![npm downloads](https://img.shields.io/npm/dm/@nestjs-redisx/rate-limit)](https://www.npmjs.com/package/@nestjs-redisx/rate-limit)
[![license](https://img.shields.io/npm/l/@nestjs-redisx/rate-limit)](https://opensource.org/licenses/MIT)

Rate limiting plugin for NestJS RedisX. Supports fixed window, sliding window, and token bucket algorithms with a declarative `@RateLimit` decorator and automatic `X-RateLimit-*` response headers.

## Installation

```bash
npm install @nestjs-redisx/core @nestjs-redisx/rate-limit ioredis
```

## Quick Example

```typescript
import { RedisModule } from '@nestjs-redisx/core';
import { RateLimitPlugin, RateLimit } from '@nestjs-redisx/rate-limit';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
      plugins: [new RateLimitPlugin({ defaultPoints: 100, defaultDuration: 60 })],
    }),
  ],
})
export class AppModule {}

@Controller('api')
export class ApiController {
  @Get('data')
  @RateLimit({ points: 10, duration: 60 })
  getData() {
    return { data: 'value' };
  }
}
```

## Documentation

Full documentation: [nestjs-redisx.dev/en/reference/rate-limit/](https://nestjs-redisx.dev/en/reference/rate-limit/)

## License

MIT
