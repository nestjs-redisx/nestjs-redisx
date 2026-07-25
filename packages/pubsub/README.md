<p align="center">
  <img src="https://raw.githubusercontent.com/nestjs-redisx/nestjs-redisx/main/website/public/images/logo.png" alt="NestJS RedisX" />
</p>

# @nestjs-redisx/pubsub

[![npm](https://img.shields.io/npm/v/@nestjs-redisx/pubsub)](https://www.npmjs.com/package/@nestjs-redisx/pubsub)
[![npm downloads](https://img.shields.io/npm/dm/@nestjs-redisx/pubsub)](https://www.npmjs.com/package/@nestjs-redisx/pubsub)
[![license](https://img.shields.io/npm/l/@nestjs-redisx/pubsub)](https://opensource.org/licenses/MIT)

Typed Redis Pub/Sub for NestJS RedisX: publish/subscribe with JSON payloads, pattern subscriptions, a `@Subscribe` decorator with automatic discovery, and a **dedicated subscriber connection** managed for you (a Redis connection in subscriber mode cannot execute regular commands — the plugin clones one from your named client automatically).

## Installation

```bash
npm install @nestjs-redisx/core @nestjs-redisx/pubsub ioredis
```

## Quick Example

```typescript
import { Module, Injectable, Inject } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { PubSubPlugin, Subscribe, PUBSUB_SERVICE, IPubSubService, IPubSubMessage } from '@nestjs-redisx/pubsub';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
      plugins: [new PubSubPlugin()],
    }),
  ],
})
export class AppModule {}

@Injectable()
export class UserEvents {
  constructor(@Inject(PUBSUB_SERVICE) private readonly pubsub: IPubSubService) {}

  async created(id: string) {
    await this.pubsub.publish('user.created', { id }); // cross-instance, typed
  }

  @Subscribe('user.created') // auto-discovered on startup
  onCreated(message: IPubSubMessage<{ id: string }>) {
    console.log(message.channel, message.data.id);
  }

  @Subscribe({ pattern: 'user.*' }) // Redis glob patterns
  onAnyUserEvent(message: IPubSubMessage) {
    console.log(message.pattern, message.channel);
  }
}
```

## Features

- **Typed publish/subscribe** — JSON payloads with generics; non-JSON messages from other systems are delivered as raw strings (fail-open interop).
- **`@Subscribe` decorator** — auto-discovered handler methods for channels and glob patterns; multiple handlers per channel multiplex over a single Redis subscription.
- **Dedicated subscriber connection** — created and managed automatically (`<client>:pubsub-subscriber`), so your main client keeps executing regular commands.
- **Subscription handles** — `unsubscribe()` per handler; the Redis subscription is released when the last handler leaves; everything cleans up on shutdown.
- **Channel prefixing** — optional `channelPrefix` namespaces your events without leaking into handler-visible names.
- **Testable without Redis** — runs on the `@nestjs-redisx/testing` in-memory driver, including cross-client delivery.

> Note: with the `node-redis` driver, Pub/Sub is supported on single-node connections; use `ioredis` for Pub/Sub over Cluster/Sentinel topologies.

## Documentation

Full reference: [nestjs-redisx.dev/en/reference/pubsub](https://nestjs-redisx.dev/en/reference/pubsub/)

## License

MIT
