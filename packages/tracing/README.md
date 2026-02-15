<p align="center">
  <img src="https://raw.githubusercontent.com/nestjs-redisx/nestjs-redisx/main/website/public/images/logo.png" alt="NestJS RedisX" />
</p>

# @nestjs-redisx/tracing

[![npm](https://img.shields.io/npm/v/@nestjs-redisx/tracing)](https://www.npmjs.com/package/@nestjs-redisx/tracing)
[![npm downloads](https://img.shields.io/npm/dm/@nestjs-redisx/tracing)](https://www.npmjs.com/package/@nestjs-redisx/tracing)
[![license](https://img.shields.io/npm/l/@nestjs-redisx/tracing)](https://opensource.org/licenses/MIT)

OpenTelemetry tracing plugin for NestJS RedisX. Automatic distributed tracing for all Redis operations with Jaeger, Zipkin, and OTLP exporter support. OpenTelemetry SDKs are bundled.

## Installation

```bash
npm install @nestjs-redisx/core @nestjs-redisx/tracing ioredis
```

## Quick Example

```typescript
import { RedisModule } from '@nestjs-redisx/core';
import { TracingPlugin } from '@nestjs-redisx/tracing';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
      plugins: [
        new TracingPlugin({
          serviceName: 'my-app',
          exporter: { type: 'otlp', endpoint: 'http://localhost:4318/v1/traces' },
        }),
      ],
    }),
  ],
})
export class AppModule {}

// All Redis commands are now traced automatically
```

## Documentation

Full documentation: [nestjs-redisx.dev/en/reference/tracing/](https://nestjs-redisx.dev/en/reference/tracing/)

## License

MIT
