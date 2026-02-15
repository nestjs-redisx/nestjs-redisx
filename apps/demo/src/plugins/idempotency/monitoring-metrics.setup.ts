import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { MetricsPlugin } from '@nestjs-redisx/metrics';
import { IdempotencyPlugin } from '@nestjs-redisx/idempotency';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
      plugins: [
        new MetricsPlugin(),
        new IdempotencyPlugin(),
      ],
    }),
  ],
})
export class AppModule {}
