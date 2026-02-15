import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { IdempotencyPlugin } from '@nestjs-redisx/idempotency';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: {
        host: 'localhost',
        port: 6379,
      },
      plugins: [
        new IdempotencyPlugin({
          defaultTtl: 86400,
          headerName: 'Idempotency-Key',
          keyPrefix: 'idempotency:',
        }),
      ],
    }),
  ],
})
export class AppModule {}
