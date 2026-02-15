import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { CachePlugin } from '@nestjs-redisx/cache';
import { LocksPlugin } from '@nestjs-redisx/locks';
import { RateLimitPlugin } from '@nestjs-redisx/rate-limit';
import { StreamsPlugin } from '@nestjs-redisx/streams';
import { TracingPlugin } from '@nestjs-redisx/tracing';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: {
        host: 'localhost',
        port: 6379,
      },
      plugins: [
        new CachePlugin(),
        new LocksPlugin(),
        new RateLimitPlugin(),
        new StreamsPlugin(),
        new TracingPlugin({
          serviceName: 'my-service',
          exporter: {
            type: 'otlp',
            endpoint: 'http://jaeger:4318',
          },
          pluginTracing: true,
        }),
      ],
    }),
  ],
})
export class AppModule {}
