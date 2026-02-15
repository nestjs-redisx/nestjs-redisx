<p align="center">
  <img src="https://raw.githubusercontent.com/nestjs-redisx/nestjs-redisx/main/website/public/images/logo.png" alt="NestJS RedisX" />
</p>

# @nestjs-redisx/streams

[![npm](https://img.shields.io/npm/v/@nestjs-redisx/streams)](https://www.npmjs.com/package/@nestjs-redisx/streams)
[![npm downloads](https://img.shields.io/npm/dm/@nestjs-redisx/streams)](https://www.npmjs.com/package/@nestjs-redisx/streams)
[![license](https://img.shields.io/npm/l/@nestjs-redisx/streams)](https://opensource.org/licenses/MIT)

Redis Streams plugin for NestJS RedisX. Provides `StreamProducerService` for publishing and `@StreamConsumer` decorator for declarative consumer groups with dead-letter queues and backpressure.

## Installation

```bash
npm install @nestjs-redisx/core @nestjs-redisx/streams ioredis
```

## Quick Example

```typescript
import { RedisModule } from '@nestjs-redisx/core';
import { StreamsPlugin, StreamConsumer, STREAM_PRODUCER, IStreamProducer } from '@nestjs-redisx/streams';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
      plugins: [new StreamsPlugin({ consumer: { batchSize: 10 }, dlq: { enabled: true } })],
    }),
  ],
})
export class AppModule {}

@Injectable()
export class OrderService {
  constructor(@Inject(STREAM_PRODUCER) private producer: IStreamProducer) {}
  async create(order: Order) {
    await this.producer.publish('orders', { orderId: order.id });
  }
}

@Injectable()
export class OrderProcessor {
  @StreamConsumer({ stream: 'orders', group: 'processors' })
  async handle(msg: { orderId: string }) { /* process */ }
}
```

## Documentation

Full documentation: [nestjs-redisx.dev/en/reference/streams/](https://nestjs-redisx.dev/en/reference/streams/)

## License

MIT
