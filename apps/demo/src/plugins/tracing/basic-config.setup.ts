import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { TracingPlugin } from '@nestjs-redisx/tracing';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: {
        host: 'localhost',
        port: 6379,
      },
      plugins: [
        new TracingPlugin({
          serviceName: 'my-service',
          exporter: {
            type: 'otlp',
            endpoint: 'http://jaeger:4318',
          },
        }),
      ],
    }),
  ],
})
export class AppModule {}
