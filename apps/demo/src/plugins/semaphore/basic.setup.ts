import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { SemaphorePlugin } from '@nestjs-redisx/semaphore';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: {
        host: 'localhost',
        port: 6379,
      },
      plugins: [
        new SemaphorePlugin({
          defaultTtl: 30_000, // permit lease; a crashed holder frees its seat after this
          maxTtl: 300_000, // hard cap for per-call ttl values
          retry: { maxRetries: 3, initialDelay: 100, maxDelay: 3_000, multiplier: 2 },
          autoRenew: { enabled: true, intervalFraction: 0.5 },
        }),
      ],
    }),
  ],
})
export class AppModule {}
