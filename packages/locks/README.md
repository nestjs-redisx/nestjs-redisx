<p align="center">
  <img src="https://raw.githubusercontent.com/nestjs-redisx/nestjs-redisx/main/website/public/images/logo.png" alt="NestJS RedisX" />
</p>

# @nestjs-redisx/locks

[![npm](https://img.shields.io/npm/v/@nestjs-redisx/locks)](https://www.npmjs.com/package/@nestjs-redisx/locks)
[![npm downloads](https://img.shields.io/npm/dm/@nestjs-redisx/locks)](https://www.npmjs.com/package/@nestjs-redisx/locks)
[![license](https://img.shields.io/npm/l/@nestjs-redisx/locks)](https://opensource.org/licenses/MIT)

Distributed locks plugin for NestJS RedisX. Provides `@WithLock` decorator and `LockService` with auto-renewal, retry strategies, and dead-lock prevention via TTL.

## Installation

```bash
npm install @nestjs-redisx/core @nestjs-redisx/locks ioredis
```

## Quick Example

```typescript
import { RedisModule } from '@nestjs-redisx/core';
import { LocksPlugin, WithLock } from '@nestjs-redisx/locks';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
      plugins: [new LocksPlugin({ defaultTtl: 30000 })],
    }),
  ],
})
export class AppModule {}

@Injectable()
export class PaymentService {
  @WithLock({ key: 'payment:{0}', ttl: 10000 })
  async processPayment(orderId: string) {
    // Only one instance processes this order at a time
  }
}
```

## Documentation

Full documentation: [nestjs-redisx.dev/en/reference/locks/](https://nestjs-redisx.dev/en/reference/locks/)

## License

MIT
