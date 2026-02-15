import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { CachePlugin } from '@nestjs-redisx/cache';
import { LocksPlugin } from '@nestjs-redisx/locks';
import { RateLimitPlugin } from '@nestjs-redisx/rate-limit';
import { IdempotencyPlugin } from '@nestjs-redisx/idempotency';
import { StreamsPlugin } from '@nestjs-redisx/streams';
import { MetricsPlugin } from '@nestjs-redisx/metrics';
import { TestController } from './test.controller';
import { TestService } from './test.service';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
      plugins: [
        new CachePlugin({ l1: { maxSize: 100 } }),
        new LocksPlugin({ defaultTtl: 10000 }),
        new RateLimitPlugin({ defaultPoints: 100, defaultDuration: 60 }),
        new IdempotencyPlugin({ defaultTtl: 300 }),
        new StreamsPlugin(),
        new MetricsPlugin(),
      ],
    }),
  ],
  controllers: [TestController],
  providers: [TestService],
})
export class AppModule {}
