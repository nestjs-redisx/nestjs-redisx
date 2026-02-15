<p align="center">
  <img src="https://raw.githubusercontent.com/nestjs-redisx/nestjs-redisx/main/website/public/images/logo.png" alt="NestJS RedisX" />
</p>

# @nestjs-redisx/idempotency

[![npm](https://img.shields.io/npm/v/@nestjs-redisx/idempotency)](https://www.npmjs.com/package/@nestjs-redisx/idempotency)
[![npm downloads](https://img.shields.io/npm/dm/@nestjs-redisx/idempotency)](https://www.npmjs.com/package/@nestjs-redisx/idempotency)
[![license](https://img.shields.io/npm/l/@nestjs-redisx/idempotency)](https://opensource.org/licenses/MIT)

HTTP idempotency plugin for NestJS RedisX. Prevents duplicate request processing using the `@Idempotent` decorator with fingerprint validation and automatic response replay.

## Installation

```bash
npm install @nestjs-redisx/core @nestjs-redisx/idempotency ioredis
```

## Quick Example

```typescript
import { RedisModule } from '@nestjs-redisx/core';
import { IdempotencyPlugin, Idempotent } from '@nestjs-redisx/idempotency';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
      plugins: [new IdempotencyPlugin({ defaultTtl: 86400 })],
    }),
  ],
})
export class AppModule {}

@Controller('payments')
export class PaymentsController {
  @Post()
  @Idempotent({ ttl: 3600 })
  async createPayment(@Body() dto: CreatePaymentDto) {
    // Executes once per Idempotency-Key header, replays cached response after
    return this.paymentsService.create(dto);
  }
}
```

## Documentation

Full documentation: [nestjs-redisx.dev/en/reference/idempotency/](https://nestjs-redisx.dev/en/reference/idempotency/)

## License

MIT
