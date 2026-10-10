import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { CountersPlugin } from '@nestjs-redisx/counters';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: {
        host: 'localhost',
        port: 6379,
      },
      plugins: [
        new CountersPlugin({
          keyPrefix: '_ctr:', // default
        }),
      ],
    }),
  ],
})
export class AppModule {}
