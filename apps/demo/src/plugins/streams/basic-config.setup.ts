import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { StreamsPlugin } from '@nestjs-redisx/streams';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: {
        host: 'localhost',
        port: 6379,
      },
      plugins: [
        new StreamsPlugin({
          consumer: {
            batchSize: 10,
            concurrency: 1,
            blockTimeout: 5000,
            maxRetries: 3,
          },
          dlq: {
            enabled: true,
          },
        }),
      ],
    }),
  ],
})
export class AppModule {}
