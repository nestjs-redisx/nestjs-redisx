import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { StreamsPlugin } from '@nestjs-redisx/streams';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: {
        default: {
          host: 'localhost',
          port: 6379,
          commandTimeout: 5000,
        },
        streams: {
          host: 'localhost',
          port: 6379,
          commandTimeout: 30000, // Higher timeout for blocking XREADGROUP
        },
      },
      plugins: [
        new StreamsPlugin({
          client: 'streams', // Uses dedicated connection
          consumer: {
            batchSize: 10,
            blockTimeout: 5000,
          },
        }),
      ],
    }),
  ],
})
export class AppModule {}
